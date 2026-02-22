import UIKit

final class GestureBridge {
  private var overlay: GestureOverlayView?

  func attach(to view: UIView, send: @escaping (String, [String: Any]) -> Void) {
    let overlay = GestureOverlayView()
    overlay.onEvent = send
    overlay.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(overlay)
    NSLayoutConstraint.activate([
      overlay.topAnchor.constraint(equalTo: view.topAnchor),
      overlay.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      overlay.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      overlay.bottomAnchor.constraint(equalTo: view.bottomAnchor),
    ])
    self.overlay = overlay
  }
}
