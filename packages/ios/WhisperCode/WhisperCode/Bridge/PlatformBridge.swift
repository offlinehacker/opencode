import Foundation
import UIKit
import WebKit

@MainActor
final class PlatformBridge {
  weak var webView: WKWebView?
  var onEvent: ((String, Any?) -> Void)?

  private let haptics = HapticBridge()
  private var whisper: WhisperBridge?
  private let config = ServerConfig()
  private let networkScan = NetworkScanBridge()
  private var didKickoffPreload = false
  private var activeObserver: NSObjectProtocol?
  private var backgroundObserver: NSObjectProtocol?

  init() {
    activeObserver = NotificationCenter.default.addObserver(
      forName: UIApplication.didBecomeActiveNotification,
      object: nil,
      queue: .main
    ) { [weak self] _ in
      self?.onEvent?("appLifecycle", ["state": "active"])
    }

    backgroundObserver = NotificationCenter.default.addObserver(
      forName: UIApplication.didEnterBackgroundNotification,
      object: nil,
      queue: .main
    ) { [weak self] _ in
      self?.onEvent?("appLifecycle", ["state": "background"])
    }
  }

  deinit {
    if let activeObserver {
      NotificationCenter.default.removeObserver(activeObserver)
    }
    if let backgroundObserver {
      NotificationCenter.default.removeObserver(backgroundObserver)
    }
  }

  private func voice() -> WhisperBridge {
    if let whisper {
      return whisper
    }
    let whisper = WhisperBridge()
    whisper.onState = { [weak self] payload in
      self?.onEvent?("voiceState", payload)
    }
    self.whisper = whisper
    return whisper
  }

  func webContentDidLoad() {
    guard !didKickoffPreload else { return }
    didKickoffPreload = true
    voice().beginPreload()
  }

  func handle(id: String, method: String, params: [String: Any], reply: @escaping @MainActor (Any?, String?) -> Void) {
    switch method {
    case "openLink":
      if let url = params["url"] as? String, let target = URL(string: url) {
        UIApplication.shared.open(target, options: [:], completionHandler: nil)
      }
      reply(nil, nil)
    case "notify":
      reply(nil, nil)
    case "haptic":
      if let style = params["style"] as? String {
        haptics.impact(style: style)
      }
      reply(nil, nil)
    case "share":
      reply(share(params: params), nil)
    case "getDefaultServerUrl":
      reply(config.getDefaultServerUrl(), nil)
    case "setDefaultServerUrl":
      config.setDefaultServerUrl(params["url"] as? String)
      reply(nil, nil)
    case "storageGet":
      reply(config.storageGet(name: params["name"] as? String, key: params["key"] as? String), nil)
    case "storageSet":
      config.storageSet(
        name: params["name"] as? String,
        key: params["key"] as? String,
        value: params["value"] as? String,
      )
      reply(nil, nil)
    case "storageRemove":
      config.storageRemove(name: params["name"] as? String, key: params["key"] as? String)
      reply(nil, nil)
    case "storageClear":
      config.storageClear(name: params["name"] as? String)
      reply(nil, nil)
    case "storageKey":
      let name = params["name"] as? String
      let index = (params["index"] as? NSNumber)?.intValue
      reply(config.storageKey(name: name, index: index), nil)
    case "storageLength":
      reply(config.storageLength(name: params["name"] as? String), nil)
    case "startRecording":
      Task { @MainActor in
        let result = await voice().start()
        reply(result, nil)
      }
    case "stopRecording":
      Task { @MainActor in
        let result = await voice().stop()
        reply(result, nil)
      }
    case "isWhisperReady":
      Task { @MainActor in
        let result = await voice().status()
        reply(result, nil)
      }
    case "checkHealth":
      let urlString = params["url"] as? String ?? ""
      Self.nativeHealthCheck(urlString: urlString) { healthy in
        Task { @MainActor in
          reply(["healthy": healthy], nil)
        }
      }
    case "scanNetwork":
      networkScan.cancel()
      networkScan.onFound = { [weak self] result in
        self?.onEvent?("scanResult", result)
      }
      networkScan.onComplete = { [weak self] in
        self?.onEvent?("scanComplete", nil)
      }
      networkScan.scan()
      reply(nil, nil)
    case "cancelScan":
      networkScan.cancel()
      reply(nil, nil)
    case "reload":
      if let webView, let url = URL(string: "tauri://localhost/") {
        webView.load(URLRequest(url: url))
      }
      reply(nil, nil)
    default:
      reply(nil, "Unknown method")
    }
  }

  private static func nativeHealthCheck(urlString: String, completion: @escaping @Sendable (Bool) -> Void) {
    guard !urlString.isEmpty,
          let url = URL(string: "\(urlString)/global/health") else {
      completion(false)
      return
    }
    var request = URLRequest(url: url)
    request.httpMethod = "GET"
    request.timeoutInterval = 5
    URLSession.shared.dataTask(with: request) { data, response, _ in
      let http = response as? HTTPURLResponse
      let healthy = http?.statusCode == 200
      DispatchQueue.main.async { completion(healthy) }
    }.resume()
  }

  private func share(params: [String: Any]) -> Bool {
    let text = params["text"] as? String
    let url = params["url"] as? String
    var items = [Any]()
    if let text { items.append(text) }
    if let url, let value = URL(string: url) { items.append(value) }
    if items.isEmpty { return false }

    let controller = UIActivityViewController(activityItems: items, applicationActivities: nil)
    if let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
       let window = scene.windows.first,
       let root = window.rootViewController {
      if let popover = controller.popoverPresentationController {
        popover.sourceView = root.view
        popover.sourceRect = CGRect(x: root.view.bounds.midX, y: root.view.bounds.midY, width: 1, height: 1)
        popover.permittedArrowDirections = []
      }
      root.present(controller, animated: true)
    }

    return true
  }
}
