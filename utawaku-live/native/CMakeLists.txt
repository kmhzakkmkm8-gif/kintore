cmake_minimum_required(VERSION 3.22)
project(UtawakuLive VERSION 0.2.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_OSX_DEPLOYMENT_TARGET "11.0" CACHE STRING "")
if(MSVC)
  set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
  add_compile_options(/utf-8) # 日本語の文字列リテラルを UTF-8 として扱う
endif()

option(UL_BUILD_TESTS "テスト（DSP・エンジン・テスト用VST3）もビルドする" ON)
set(UL_JUCE_DIR "" CACHE PATH "JUCE のソース（空なら GitHub から取得）")
set(UL_ASIO_SDK "" CACHE PATH "Steinberg ASIO SDK のパス（Windows で ASIO を使う場合）")

if(UL_JUCE_DIR)
  add_subdirectory(${UL_JUCE_DIR} JUCE)
else()
  include(FetchContent)
  FetchContent_Declare(JUCE GIT_REPOSITORY https://github.com/juce-framework/JUCE.git GIT_TAG 8.0.10 GIT_SHALLOW TRUE)
  FetchContent_MakeAvailable(JUCE)
endif()

set(UL_ENGINE_SOURCES
  Source/Params.cpp
  Source/MixerEngine.cpp
  Source/PluginChain.cpp
  Source/BrowserBridge.cpp
  Source/CompanionPage.cpp)

set(UL_DEFS
  JUCE_PLUGINHOST_VST3=1
  JUCE_PLUGINHOST_AU=1
  JUCE_PLUGINHOST_LV2=0
  JUCE_WEB_BROWSER=0
  JUCE_USE_CURL=0
  JUCE_DISPLAY_SPLASH_SCREEN=0
  JUCE_USE_MP3AUDIOFORMAT=1
  JUCE_STRICT_REFCOUNTEDPOINTER=1)
if(UL_ASIO_SDK)
  list(APPEND UL_DEFS JUCE_ASIO=1)
endif()

# ------------------------------------------------------------ アプリ本体
juce_add_gui_app(UtawakuLive
  PRODUCT_NAME "UTAWAKU LIVE"
  COMPANY_NAME "UTAWAKU LIVE"
  BUNDLE_ID "app.utawaku.live"
  MICROPHONE_PERMISSION_ENABLED TRUE
  MICROPHONE_PERMISSION_TEXT "マイクの音を処理して配信に送るために使います"
  VERSION ${PROJECT_VERSION})

target_sources(UtawakuLive PRIVATE
  ${UL_ENGINE_SOURCES}
  Source/PluginHost.cpp
  Source/ui/Widgets.cpp
  Source/ui/MainComponent.cpp
  Source/Main.cpp)
target_compile_definitions(UtawakuLive PRIVATE ${UL_DEFS}
  JUCE_APPLICATION_NAME_STRING="$<TARGET_PROPERTY:UtawakuLive,JUCE_PRODUCT_NAME>"
  JUCE_APPLICATION_VERSION_STRING="$<TARGET_PROPERTY:UtawakuLive,JUCE_VERSION>")
if(UL_ASIO_SDK)
  target_include_directories(UtawakuLive PRIVATE ${UL_ASIO_SDK}/common)
endif()
target_link_libraries(UtawakuLive PRIVATE
  juce::juce_audio_utils juce::juce_audio_processors juce::juce_dsp juce::juce_gui_extra
  PUBLIC juce::juce_recommended_config_flags juce::juce_recommended_lto_flags juce::juce_recommended_warning_flags)

# ------------------------------------------------------------ テスト
if(UL_BUILD_TESTS)
  enable_testing()
  add_executable(ul_dsp_tests Tests/DspTests.cpp)
  add_test(NAME dsp COMMAND ul_dsp_tests)

  # テスト用の VST3（-6dB・64サンプルのレイテンシを報告）
  juce_add_plugin(ULTestGain
    PRODUCT_NAME "UL Test Gain"
    COMPANY_NAME "UTAWAKU LIVE"
    PLUGIN_MANUFACTURER_CODE Utwk
    PLUGIN_CODE Ultg
    FORMATS VST3
    IS_SYNTH FALSE
    NEEDS_MIDI_INPUT FALSE
    COPY_PLUGIN_AFTER_BUILD FALSE)
  target_sources(ULTestGain PRIVATE Tests/TestGainPlugin.cpp)
  target_compile_definitions(ULTestGain PUBLIC JUCE_WEB_BROWSER=0 JUCE_USE_CURL=0 JUCE_VST3_CAN_REPLACE_VST2=0 JUCE_DISPLAY_SPLASH_SCREEN=0)
  target_link_libraries(ULTestGain PRIVATE juce::juce_audio_utils PUBLIC juce::juce_recommended_config_flags)

  juce_add_console_app(ul_engine_tests PRODUCT_NAME "ul_engine_tests")
  target_sources(ul_engine_tests PRIVATE ${UL_ENGINE_SOURCES} Tests/EngineTests.cpp)
  target_compile_definitions(ul_engine_tests PRIVATE ${UL_DEFS}
    UL_TEST_PLUGIN_BINDIR="$<TARGET_FILE_DIR:ULTestGain_VST3>")
  target_link_libraries(ul_engine_tests PRIVATE
    juce::juce_audio_utils juce::juce_audio_processors juce::juce_dsp
    PUBLIC juce::juce_recommended_config_flags)
  add_dependencies(ul_engine_tests ULTestGain_VST3)
  add_test(NAME engine COMMAND ul_engine_tests)
endif()
