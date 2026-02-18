import UIKit

final class GestureOverlayView: UIView {
  var onEvent: ((String, [String: Any]) -> Void)?

  override init(frame: CGRect) {
    super.init(frame: frame)
    backgroundColor = .clear
    isUserInteractionEnabled = true
  }

  required init?(coder: NSCoder) {
    super.init(coder: coder)
    backgroundColor = .clear
    isUserInteractionEnabled = true
  }
}
