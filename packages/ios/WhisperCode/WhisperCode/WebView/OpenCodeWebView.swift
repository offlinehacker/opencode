import SwiftUI
import WebKit

struct OpenCodeWebView: UIViewRepresentable {
  func makeCoordinator() -> BridgeController {
    BridgeController()
  }

  func makeUIView(context: Context) -> WKWebView {
    let webView = WKWebView(frame: .zero, configuration: context.coordinator.configuration)
    context.coordinator.attach(to: webView)
    return webView
  }

  func updateUIView(_ uiView: WKWebView, context: Context) {}
}
