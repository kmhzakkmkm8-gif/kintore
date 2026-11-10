#include "BrowserBridge.h"

namespace ul {

// ---------------------------------------------------------------- SHA-1（WebSocket ハンドシェイク用）
std::string sha1(const std::string& data) {
    uint32_t h[5] = { 0x67452301, 0xEFCDAB89, 0x98BADCFE, 0x10325476, 0xC3D2E1F0 };
    std::string m = data;
    const uint64_t bitLen = (uint64_t) data.size() * 8;
    m.push_back((char) 0x80);
    while (m.size() % 64 != 56) m.push_back(0);
    for (int i = 7; i >= 0; --i) m.push_back((char) ((bitLen >> (i * 8)) & 0xff));
    auto rol = [](uint32_t x, int n) { return (x << n) | (x >> (32 - n)); };
    for (size_t off = 0; off < m.size(); off += 64) {
        uint32_t w[80];
        for (int i = 0; i < 16; ++i)
            w[i] = (uint32_t) (uint8_t) m[off + i * 4] << 24 | (uint32_t) (uint8_t) m[off + i * 4 + 1] << 16
                 | (uint32_t) (uint8_t) m[off + i * 4 + 2] << 8 | (uint32_t) (uint8_t) m[off + i * 4 + 3];
        for (int i = 16; i < 80; ++i) w[i] = rol(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
        uint32_t a = h[0], b = h[1], c = h[2], d = h[3], e = h[4];
        for (int i = 0; i < 80; ++i) {
            uint32_t f, k;
            if (i < 20) { f = (b & c) | (~b & d); k = 0x5A827999; }
            else if (i < 40) { f = b ^ c ^ d; k = 0x6ED9EBA1; }
            else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8F1BBCDC; }
            else { f = b ^ c ^ d; k = 0xCA62C1D6; }
            const uint32_t t = rol(a, 5) + f + e + k + w[i];
            e = d; d = c; c = rol(b, 30); b = a; a = t;
        }
        h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e;
    }
    std::string out;
    for (uint32_t v : h)
        for (int i = 3; i >= 0; --i) out.push_back((char) ((v >> (i * 8)) & 0xff));
    return out;
}

static bool readLine(juce::StreamingSocket& s, juce::String& line) {
    std::string buf;
    char c;
    while (buf.size() < 8192) {
        if (s.read(&c, 1, true) != 1) return false;
        if (c == '\n') break;
        if (c != '\r') buf.push_back(c);
    }
    line = juce::String::fromUTF8(buf.data(), (int) buf.size());
    return true;
}

static bool writeAll(juce::StreamingSocket& s, const void* data, int n) {
    return s.write(data, n) == n;
}

// ---------------------------------------------------------------- クライアント（WebSocket）スレッド
class BrowserBridge::ClientThread : public juce::Thread {
public:
    ClientThread(BrowserBridge& o, std::unique_ptr<juce::StreamingSocket> s) : juce::Thread("UL bridge client"), owner(o), sock(std::move(s)) {}
    ~ClientThread() override {
        sock->close();
        stopThread(2000);
    }
    void run() override {
        owner.clientConnected.store(true);
        owner.serveWebSocket(*sock);
        owner.clientConnected.store(false);
    }
    BrowserBridge& owner;
    std::unique_ptr<juce::StreamingSocket> sock;
};

BrowserBridge::BrowserBridge(ClockBridge& target, int p) : juce::Thread("UL bridge listener"), bridge(target), port(p) {}

BrowserBridge::~BrowserBridge() { stop(); }

bool BrowserBridge::start() {
    listener = std::make_unique<juce::StreamingSocket>();
    if (!listener->createListener(port, "127.0.0.1")) {
        listener.reset();
        return false;
    }
    listening.store(true);
    startThread();
    return true;
}

void BrowserBridge::stop() {
    listening.store(false);
    if (listener) listener->close();
    stopThread(2000);
    client.reset();
    listener.reset();
}

juce::String BrowserBridge::getClientInfo() const {
    const juce::ScopedLock sl(infoLock);
    return clientInfo;
}

void BrowserBridge::run() {
    while (!threadShouldExit() && listening.load()) {
        std::unique_ptr<juce::StreamingSocket> s(listener->waitForNextConnection());
        if (s == nullptr) {
            if (threadShouldExit() || !listening.load()) break;
            continue;
        }
        handleConnection(std::move(s));
    }
}

void BrowserBridge::handleConnection(std::unique_ptr<juce::StreamingSocket> s) {
    if (s->waitUntilReady(true, 2000) != 1) return;
    juce::String requestLine, line, key, path;
    if (!readLine(*s, requestLine)) return;
    path = requestLine.fromFirstOccurrenceOf(" ", false, false).upToFirstOccurrenceOf(" ", false, false);
    bool upgrade = false;
    while (readLine(*s, line) && line.isNotEmpty()) {
        const auto name = line.upToFirstOccurrenceOf(":", false, false).trim().toLowerCase();
        const auto value = line.fromFirstOccurrenceOf(":", false, false).trim();
        if (name == "sec-websocket-key") key = value;
        if (name == "upgrade" && value.equalsIgnoreCase("websocket")) upgrade = true;
        if (name == "origin" && !(value.startsWith("http://localhost") || value.startsWith("http://127.0.0.1"))) {
            // 他サイトからの接続は拒否（ローカルの連携ページだけを受け付ける）
            const char* resp = "HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
            writeAll(*s, resp, (int) strlen(resp));
            return;
        }
    }
    if (upgrade && key.isNotEmpty()) {
        const auto digest = sha1(key.toStdString() + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11");
        const auto accept = juce::Base64::toBase64(digest.data(), digest.size());
        const juce::String resp = "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: "
                                + accept + "\r\n\r\n";
        if (!writeAll(*s, resp.toRawUTF8(), (int) resp.getNumBytesAsUTF8())) return;
        client.reset(); // 既存の接続は切って新しいタブに切り替える
        client = std::make_unique<ClientThread>(*this, std::move(s));
        client->startThread(juce::Thread::Priority::high);
        return;
    }
    juce::String body, type = "text/html; charset=utf-8", status = "200 OK";
    if (path == "/" || path.startsWith("/?") || path == "/index.html") body = companionPageHtml;
    else { status = "404 Not Found"; body = "not found"; type = "text/plain"; }
    const juce::String head = "HTTP/1.1 " + status + "\r\nContent-Type: " + type + "\r\nContent-Length: " + juce::String((int) body.getNumBytesAsUTF8())
                            + "\r\nCache-Control: no-cache\r\nConnection: close\r\n\r\n";
    writeAll(*s, head.toRawUTF8(), (int) head.getNumBytesAsUTF8());
    writeAll(*s, body.toRawUTF8(), (int) body.getNumBytesAsUTF8());
}

void BrowserBridge::serveWebSocket(juce::StreamingSocket& s) {
    std::vector<uint8_t> payload;
    std::vector<float> L(8192), R(8192);
    auto* thread = juce::Thread::getCurrentThread();
    while (thread != nullptr && !thread->threadShouldExit()) {
        uint8_t hdr[2];
        if (s.read(hdr, 2, true) != 2) break;
        const int opcode = hdr[0] & 0x0f;
        const bool masked = (hdr[1] & 0x80) != 0;
        uint64_t len = hdr[1] & 0x7f;
        if (len == 126) {
            uint8_t e[2];
            if (s.read(e, 2, true) != 2) break;
            len = (uint64_t) e[0] << 8 | e[1];
        } else if (len == 127) {
            uint8_t e[8];
            if (s.read(e, 8, true) != 8) break;
            len = 0;
            for (int i = 0; i < 8; ++i) len = len << 8 | e[i];
        }
        if (len > (1u << 20)) break; // 1MB を超えるフレームは不正とみなす
        uint8_t mask[4] = { 0, 0, 0, 0 };
        if (masked && s.read(mask, 4, true) != 4) break;
        payload.resize((size_t) len);
        if (len > 0 && s.read(payload.data(), (int) len, true) != (int) len) break;
        if (masked)
            for (size_t i = 0; i < payload.size(); ++i) payload[i] ^= mask[i & 3];

        if (opcode == 0x8) break; // close
        if (opcode == 0x9) {      // ping → pong
            std::vector<uint8_t> f { 0x8A, (uint8_t) std::min<size_t>(payload.size(), 125) };
            f.insert(f.end(), payload.begin(), payload.begin() + (long) f[1]);
            writeAll(s, f.data(), (int) f.size());
            continue;
        }
        if (opcode == 0x1) { // text: {"sampleRate":48000,"channels":2,"label":"..."}
            auto v = juce::JSON::parse(juce::String::fromUTF8((const char*) payload.data(), (int) payload.size()));
            const double sr = v.getProperty("sampleRate", 48000.0);
            bridge.setProducerRate(sr);
            const juce::ScopedLock sl(infoLock);
            clientInfo = v.getProperty("label", juce::String::fromUTF8("ブラウザ")).toString() + " / " + juce::String(sr / 1000.0, 1) + " kHz";
            continue;
        }
        if (opcode == 0x2) { // binary: Float32 LE インターリーブ・ステレオ
            const int frames = (int) (payload.size() / 8);
            if (frames <= 0 || frames > 8192) continue;
            const float* f = reinterpret_cast<const float*>(payload.data());
            for (int i = 0; i < frames; ++i) {
                L[(size_t) i] = std::isfinite(f[2 * i]) ? f[2 * i] : 0.0f;
                R[(size_t) i] = std::isfinite(f[2 * i + 1]) ? f[2 * i + 1] : 0.0f;
            }
            bridge.push(L.data(), R.data(), frames);
        }
    }
    const juce::ScopedLock sl(infoLock);
    clientInfo = {};
}

} // namespace ul
