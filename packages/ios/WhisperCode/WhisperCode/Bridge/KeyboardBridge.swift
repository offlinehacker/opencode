import UIKit
import WebKit
import ObjectiveC

// File-scope associated-object key and C-function IMP — kept outside the
// @MainActor class so they are nonisolated and avoid Swift 6 strict-
// concurrency issues with @convention(block) inside an actor context.
private nonisolated(unsafe) var kToolbarKey: UInt8 = 0

private let _accessoryViewIMP: @convention(c) (AnyObject, Selector) -> UIView? = { obj, _ in
  objc_getAssociatedObject(obj, &kToolbarKey) as? UIView
}

final class KeyboardBridge: NSObject {
  var onNavigate: ((String) -> Void)?
  var onClear: (() -> Void)?
  var onNewline: (() -> Void)?
  var onDismiss: (() -> Void)?

  private weak var webView: WKWebView?
  private var dynamicSubclass: AnyClass?
  private var observer: NSObjectProtocol?
  private var didShowObserver: NSObjectProtocol?

  func attach(to webView: WKWebView) {
    self.webView = webView
    let handler: (Notification) -> Void = { [weak self] _ in
      self?.installToolbar()
    }
    observer = NotificationCenter.default.addObserver(
      forName: UIResponder.keyboardWillShowNotification,
      object: nil, queue: .main, using: handler
    )
    didShowObserver = NotificationCenter.default.addObserver(
      forName: UIResponder.keyboardDidShowNotification,
      object: nil, queue: .main, using: handler
    )
  }

  deinit {
    if let observer { NotificationCenter.default.removeObserver(observer) }
    if let didShowObserver { NotificationCenter.default.removeObserver(didShowObserver) }
  }

  private func installToolbar() {
    guard let webView else { return }
    guard let contentView = findContentView(in: webView.scrollView) else { return }

    let needsReload = objc_getAssociatedObject(contentView, &kToolbarKey) == nil

    let toolbar = buildToolbar()
    let subclass = ensureDynamicSubclass(for: contentView)

    object_setClass(contentView, subclass)
    objc_setAssociatedObject(contentView, &kToolbarKey, toolbar, .OBJC_ASSOCIATION_RETAIN_NONATOMIC)

    if needsReload {
      contentView.reloadInputViews()
    }
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
    let imp = unsafeBitCast(_accessoryViewIMP, to: IMP.self)
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
    let clear = UIBarButtonItem(
      image: UIImage(systemName: "trash"),
      style: .plain,
      target: self,
      action: #selector(clearTapped)
    )
    let newline = UIBarButtonItem(
      title: "\\n",
      style: .plain,
      target: self,
      action: #selector(newlineTapped)
    )
    let flex = UIBarButtonItem(barButtonSystemItem: .flexibleSpace, target: nil, action: nil)
    let dismiss = UIBarButtonItem(
      image: UIImage(systemName: "keyboard.chevron.compact.down"),
      style: .plain,
      target: self,
      action: #selector(dismissTapped)
    )

    toolbar.items = [up, down, clear, newline, flex, dismiss]
    return toolbar
  }

  @objc private func upTapped() { onNavigate?("up") }
  @objc private func downTapped() { onNavigate?("down") }
  @objc private func clearTapped() { onClear?() }
  @objc private func newlineTapped() { onNewline?() }
  @objc private func dismissTapped() { onDismiss?() }
}
