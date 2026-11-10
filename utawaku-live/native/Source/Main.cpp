#include "ui/MainComponent.h"

class UtawakuLiveApp : public juce::JUCEApplication {
public:
    const juce::String getApplicationName() override { return "UTAWAKU LIVE"; }
    const juce::String getApplicationVersion() override { return JUCE_APPLICATION_VERSION_STRING; }
    bool moreThanOneInstanceAllowed() override { return false; }

    void initialise(const juce::String&) override {
        juce::PropertiesFile::Options o;
        o.applicationName = "UTAWAKU LIVE";
        o.filenameSuffix = ".settings";
        o.folderName = "UTAWAKU LIVE";
        o.osxLibrarySubFolder = "Application Support";
        props.setStorageParameters(o);
        window = std::make_unique<MainWindow>(*props.getUserSettings());
    }
    void shutdown() override {
        window.reset();
        props.closeFiles();
    }
    void systemRequestedQuit() override { quit(); }

    class MainWindow : public juce::DocumentWindow {
    public:
        explicit MainWindow(juce::PropertiesFile& settings)
            : DocumentWindow("UTAWAKU LIVE", juce::Colour(0xff0f1115), DocumentWindow::allButtons) {
            setUsingNativeTitleBar(true);
            setContentOwned(new ul::MainComponent(settings), true);
            setResizable(true, true);
            setResizeLimits(480, 480, 10000, 10000);
            centreWithSize(getWidth(), getHeight());
            setVisible(true);
        }
        void closeButtonPressed() override { JUCEApplication::getInstance()->systemRequestedQuit(); }
    };

private:
    juce::ApplicationProperties props;
    std::unique_ptr<MainWindow> window;
};

START_JUCE_APPLICATION(UtawakuLiveApp)
