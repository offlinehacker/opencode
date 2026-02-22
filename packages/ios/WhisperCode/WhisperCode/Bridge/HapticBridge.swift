import UIKit

final class HapticBridge {
  func impact(style: String) {
    switch style {
    case "success":
      notify(.success)
    case "warning":
      notify(.warning)
    case "error":
      notify(.error)
    case "light":
      impact(.light)
    case "medium":
      impact(.medium)
    case "heavy":
      impact(.heavy)
    default:
      return
    }
  }

  private func impact(_ style: UIImpactFeedbackGenerator.FeedbackStyle) {
    let generator = UIImpactFeedbackGenerator(style: style)
    generator.prepare()
    generator.impactOccurred()
  }

  private func notify(_ type: UINotificationFeedbackGenerator.FeedbackType) {
    let generator = UINotificationFeedbackGenerator()
    generator.prepare()
    generator.notificationOccurred(type)
  }
}
