import UIKit

final class GestureOverlayView: UIView {
  var onEvent: ((String, [String: Any]) -> Void)?

  override init(frame: CGRect) {
    super.init(frame: frame)
    backgroundColor = .clear
  }

  required init?(coder: NSCoder) {
    super.init(coder: coder)
    backgroundColor = .clear
  }

  override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
    // Pass all touches through to the WebView underneath
    return nil
  }
}
