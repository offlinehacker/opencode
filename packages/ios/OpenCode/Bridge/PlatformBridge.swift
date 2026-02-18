import Foundation
import UIKit
import WebKit

final class PlatformBridge {
  weak var webView: WKWebView?
  var onEvent: ((String, Any?) -> Void)?

  private let haptics = HapticBridge()
  private let whisper = WhisperBridge()
  private let config = ServerConfig()

  init() {
    whisper.onEvent = { [weak self] payload in
      self?.onEvent?("transcription", payload)
    }
  }

  func handle(id: String, method: String, params: [String: Any], reply: @escaping (Any?, String?) -> Void) {
    switch method {
    case "openLink":
      if let url = params["url"] as? String, let target = URL(string: url) {
        DispatchQueue.main.async {
          UIApplication.shared.open(target, options: [:], completionHandler: nil)
        }
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
      whisper.start()
      reply(nil, nil)
    case "stopRecording":
      whisper.stop { text in
        reply(text, nil)
      }
    default:
      reply(nil, "Unknown method")
    }
  }

  private func share(params: [String: Any]) -> Bool {
    let text = params["text"] as? String
    let url = params["url"] as? String
    var items = [Any]()
    if let text { items.append(text) }
    if let url, let value = URL(string: url) { items.append(value) }
    if items.isEmpty { return false }

    DispatchQueue.main.async {
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
    }

    return true
  }
}
