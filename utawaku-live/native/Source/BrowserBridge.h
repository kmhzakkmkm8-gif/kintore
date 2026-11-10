// ブラウザ連携：http://localhost:PORT/ で連携ページを配信し、そのページが共有した
// YouTube タブの音声を WebSocket（Float32 ステレオ）で受け取って ClockBridge に流す。
#pragma once
#include "ClockBridge.h"
#include <juce_core/juce_core.h>

namespace ul {

std::string sha1(const std::string& data); // 20 バイトのダイジェスト

class BrowserBridge : private juce::Thread {
public:
    BrowserBridge(ClockBridge& target, int port);
    ~BrowserBridge() override;

    bool start();
    void stop();
    int getPort() const { return port; }
    juce::String getUrl() const { return "http://localhost:" + juce::String(port) + "/"; }
    bool isListening() const { return listening.load(); }
    bool isClientConnected() const { return clientConnected.load(); }
    juce::String getClientInfo() const;

private:
    void run() override;
    void handleConnection(std::unique_ptr<juce::StreamingSocket> s);
    void serveWebSocket(juce::StreamingSocket& s);

    class ClientThread;
    ClockBridge& bridge;
    const int port;
    std::unique_ptr<juce::StreamingSocket> listener;
    std::unique_ptr<ClientThread> client;
    std::atomic<bool> listening { false }, clientConnected { false };
    mutable juce::CriticalSection infoLock;
    juce::String clientInfo;
};

extern const char* const companionPageHtml;

} // namespace ul
