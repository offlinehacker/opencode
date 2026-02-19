import WebKit

final class BridgeController: NSObject, WKScriptMessageHandler {
  private let userContent = WKUserContentController()
  private let platform = PlatformBridge()
  private let gestures = GestureBridge()
  private let keyboard = KeyboardBridge()
  private weak var webView: WKWebView?

  var configuration: WKWebViewConfiguration {
    let config = WKWebViewConfiguration()
    config.userContentController = userContent
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

    if let url = Bundle.main.url(forResource: "index", withExtension: "html") {
      webView.loadFileURL(url, allowingReadAccessTo: Bundle.main.bundleURL)
    }
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
}
