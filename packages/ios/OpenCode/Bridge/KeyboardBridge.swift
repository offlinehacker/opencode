import UIKit
import WebKit
import ObjectiveC

final class KeyboardBridge {
  var onNavigate: ((String) -> Void)?
  var onDismiss: (() -> Void)?

  private weak var webView: WKWebView?
  private var dynamicSubclass: AnyClass?
  private var observer: NSObjectProtocol?

  func attach(to webView: WKWebView) {
    self.webView = webView
    observer = NotificationCenter.default.addObserver(
      forName: UIResponder.keyboardWillShowNotification,
      object: nil,
      queue: .main
    ) { [weak self] _ in
      self?.installToolbar()
    }
  }

  deinit {
    if let observer { NotificationCenter.default.removeObserver(observer) }
  }

  private func installToolbar() {
    guard let webView else { return }
    guard let contentView = findContentView(in: webView.scrollView) else { return }

    let toolbar = buildToolbar()
    let subclass = ensureDynamicSubclass(for: contentView)

    object_setClass(contentView, subclass)
    objc_setAssociatedObject(contentView, &AssociatedKeys.toolbar, toolbar, .OBJC_ASSOCIATION_RETAIN_NONATOMIC)
  }

  private func findContentView(in scrollView: UIScrollView) -> UIView? {
    scrollView.subviews.first { NSStringFromClass(type(of: $0)).hasPrefix("WKContent") }
  }

  private func ensureDynamicSubclass(for view: UIView) -> AnyClass {
    if let existing = dynamicSubclass { return existing }

    let originalClass: AnyClass = type(of: view)
    let subclassName = "OC_\(NSStringFromClass(originalClass))"

    if let existing = objc_getClass(subclassName) as? AnyClass {
      dynamicSubclass = existing
      return existing
    }

    guard let subclass = objc_allocateClassPair(originalClass, subclassName, 0) else {
      return originalClass
    }

    let selector = #selector(getter: UIResponder.inputAccessoryView)
    let method: @convention(block) (AnyObject) -> UIView? = { obj in
      objc_getAssociatedObject(obj, &AssociatedKeys.toolbar) as? UIView
    }
    let imp = imp_implementationWithBlock(method)
    class_addMethod(subclass, selector, imp, "@@:")

    objc_registerClassPair(subclass)
    dynamicSubclass = subclass
    return subclass
  }

  private func buildToolbar() -> UIToolbar {
    let toolbar = UIToolbar(frame: CGRect(x: 0, y: 0, width: 0, height: 44))
    toolbar.sizeToFit()

    let up = UIBarButtonItem(
      image: UIImage(systemName: "chevron.up"),
      style: .plain,
      target: self,
      action: #selector(upTapped)
    )
    let down = UIBarButtonItem(
      image: UIImage(systemName: "chevron.down"),
      style: .plain,
      target: self,
      action: #selector(downTapped)
    )
    let flex = UIBarButtonItem(barButtonSystemItem: .flexibleSpace, target: nil, action: nil)
    let dismiss = UIBarButtonItem(
      image: UIImage(systemName: "keyboard.chevron.compact.down"),
      style: .plain,
      target: self,
      action: #selector(dismissTapped)
    )

    toolbar.items = [up, down, flex, dismiss]
    return toolbar
  }

  @objc private func upTapped() { onNavigate?("up") }
  @objc private func downTapped() { onNavigate?("down") }
  @objc private func dismissTapped() { onDismiss?() }
}

private enum AssociatedKeys {
  static var toolbar: UInt8 = 0
}
