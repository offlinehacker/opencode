import WebKit
import UniformTypeIdentifiers

// MARK: - Local file scheme handler

final class LocalFileSchemeHandler: NSObject, WKURLSchemeHandler {
  private let baseDirectory: URL

  init(baseDirectory: URL) {
    self.baseDirectory = baseDirectory
  }

  func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
    guard let url = urlSchemeTask.request.url else {
      urlSchemeTask.didFailWithError(URLError(.badURL))
      return
    }

    // Map the URL path to a local file
    var path = url.path
    if path.isEmpty || path == "/" { path = "/index.html" }

    let fileURL = baseDirectory.appendingPathComponent(path)

    guard let data = try? Data(contentsOf: fileURL) else {
      print("[OpenCode] SchemeHandler 404: \(path)")
      urlSchemeTask.didFailWithError(URLError(.fileDoesNotExist))
      return
    }

    let mimeType = Self.mimeType(for: fileURL.pathExtension)
    let response = HTTPURLResponse(
      url: url,
      statusCode: 200,
      httpVersion: "HTTP/1.1",
      headerFields: [
        "Content-Type": mimeType,
        "Content-Length": "\(data.count)",
        "Access-Control-Allow-Origin": "*",
      ]
    )!
    urlSchemeTask.didReceive(response)
    urlSchemeTask.didReceive(data)
    urlSchemeTask.didFinish()
  }

  func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}

  private static func mimeType(for ext: String) -> String {
    if let utType = UTType(filenameExtension: ext), let mime = utType.preferredMIMEType {
      return mime
    }
    switch ext.lowercased() {
    case "js", "mjs": return "application/javascript"
    case "css": return "text/css"
    case "html", "htm": return "text/html"
    case "json": return "application/json"
    case "svg": return "image/svg+xml"
    case "woff": return "font/woff"
    case "woff2": return "font/woff2"
    case "ttf": return "font/ttf"
    case "png": return "image/png"
    case "ico": return "image/x-icon"
    case "aac": return "audio/aac"
    case "webmanifest": return "application/manifest+json"
    default: return "application/octet-stream"
    }
  }
}

// MARK: - Bridge Controller

final class BridgeController: NSObject, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate {
  private let userContent = WKUserContentController()
  private let platform = PlatformBridge()
  private let gestures = GestureBridge()
  private let keyboard = KeyboardBridge()
  private weak var webView: WKWebView?
  private var schemeHandler: LocalFileSchemeHandler?

  var configuration: WKWebViewConfiguration {
    let config = WKWebViewConfiguration()
    config.userContentController = userContent

    // Register custom scheme handler for release builds
    #if !DEBUG
    let handler = Self.resolveWebAssets()
    if let handler {
      config.setURLSchemeHandler(handler, forURLScheme: "app-local")
      self.schemeHandler = handler
      print("[OpenCode] Registered app-local:// scheme handler")
    }
    #endif

    return config
  }

  override init() {
    super.init()
    userContent.add(self, name: "opencode")
    platform.onEvent = { [weak self] type, payload in
      self?.sendEvent(type: type, payload: payload)
    }
  }

  func attach(to webView: WKWebView) {
    self.webView = webView
    webView.navigationDelegate = self
    platform.webView = webView
    gestures.attach(to: webView) { [weak self] type, payload in
      self?.sendEvent(type: type, payload: payload)
    }
    keyboard.attach(to: webView)
    keyboard.onNavigate = { [weak self] direction in
      self?.sendEvent(type: "keyboardNavigation", payload: ["direction": direction])
    }
    keyboard.onClear = { [weak self] in
      self?.sendEvent(type: "keyboardClear", payload: nil)
    }
    keyboard.onNewline = { [weak self] in
      self?.sendEvent(type: "keyboardNewline", payload: nil)
    }
    keyboard.onDismiss = { webView.endEditing(true) }
    loadStartPage(in: webView)
  }

  func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
    guard let body = message.body as? [String: Any] else { return }
    guard let id = body["id"] as? String else { return }
    guard let method = body["method"] as? String else { return }
    let params = body["params"] as? [String: Any] ?? [:]

    platform.handle(id: id, method: method, params: params) { [weak self] result, error in
      self?.sendResponse(id: id, result: result, error: error)
    }
  }

  private func loadStartPage(in webView: WKWebView) {
#if DEBUG
    if let url = URL(string: "http://192.168.50.251:1421") {
      webView.load(URLRequest(url: url))
      return
    }
#endif

    // Use custom scheme to avoid file:// CORS restrictions with ES modules
    if schemeHandler != nil, let url = URL(string: "app-local://localhost/index.html") {
      print("[OpenCode] Loading via app-local:// scheme")
      webView.load(URLRequest(url: url))
      return
    }

    // Fallback to file:// (shouldn't reach here in release)
    if let url = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "WebAssets") {
      webView.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
    } else if let url = Bundle.main.url(forResource: "index", withExtension: "html") {
      webView.loadFileURL(url, allowingReadAccessTo: Bundle.main.bundleURL)
    }
  }

  /// Locate web assets in the bundle and return a scheme handler for them
  private static func resolveWebAssets() -> LocalFileSchemeHandler? {
    let fileManager = FileManager.default
    let bundlePath = Bundle.main.bundlePath

    // Check for WebAssets subdirectory first (folder reference)
    let webAssetsDir = (bundlePath as NSString).appendingPathComponent("WebAssets")
    if fileManager.fileExists(atPath: (webAssetsDir as NSString).appendingPathComponent("index.html")) {
      print("[OpenCode] Serving from WebAssets/ subdirectory")
      return LocalFileSchemeHandler(baseDirectory: URL(fileURLWithPath: webAssetsDir))
    }

    // Flattened at bundle root
    if fileManager.fileExists(atPath: (bundlePath as NSString).appendingPathComponent("index.html")) {
      print("[OpenCode] Serving from bundle root (flattened)")
      return LocalFileSchemeHandler(baseDirectory: URL(fileURLWithPath: bundlePath))
    }

    print("[OpenCode] ERROR: No web assets found in bundle!")
    return nil
  }

  private func sendResponse(id: String, result: Any?, error: String?) {
    let payload: [Any] = [id, result ?? NSNull(), error ?? NSNull()]
    sendBridgeCall(function: "onResponse", payload: payload)
  }

  private func sendEvent(type: String, payload: Any?) {
    let payload: [Any] = [type, payload ?? NSNull()]
    sendBridgeCall(function: "onEvent", payload: payload)
  }

  private func sendBridgeCall(function: String, payload: [Any]) {
    guard let webView else { return }
    guard let data = try? JSONSerialization.data(withJSONObject: payload, options: []) else { return }
    guard let json = String(data: data, encoding: .utf8) else { return }
    let script = "window.__OPENCODE_BRIDGE__ && window.__OPENCODE_BRIDGE__.\(function).apply(null, \(json))"
    webView.evaluateJavaScript(script, completionHandler: nil)
  }

  // MARK: - WKNavigationDelegate

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    print("[OpenCode] Loaded: \(webView.url?.absoluteString ?? "nil")")
  }

  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
    print("[OpenCode] Load failed: \(error.localizedDescription)")
  }

  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    print("[OpenCode] Navigation failed: \(error.localizedDescription)")
  }
}
