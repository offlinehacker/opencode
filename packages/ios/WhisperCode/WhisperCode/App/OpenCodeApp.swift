import SwiftUI
import UIKit
import UserNotifications
import os

private let log = Logger(subsystem: "opencode", category: "OpenCodeApp")

final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    UNUserNotificationCenter.current().delegate = self
    clearNotificationBadge()
    return true
  }

  func applicationDidBecomeActive(_ application: UIApplication) {
    clearNotificationBadge()
  }

  func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
    Task { @MainActor in
      PushBridge.shared.tokenDidUpdate(deviceToken)
    }
  }

  func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
    Task { @MainActor in
      PushBridge.shared.tokenDidFail()
    }
  }

  func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    willPresent notification: UNNotification,
    withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
  ) {
    // UPSTREAM-DIVERGENCE: The mobile fork uses iOS badges as ephemeral attention signals only.
    // Foreground pushes can otherwise set the app icon to 1 without a later activation event to
    // clear it, leaving a stale badge even after the in-app notification state is viewed.
    clearNotificationBadge()
    completionHandler([.banner, .list, .sound])
  }

  func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    didReceive response: UNNotificationResponse,
    withCompletionHandler completionHandler: @escaping () -> Void
  ) {
    Task { @MainActor in
      clearNotificationBadge()
      PushBridge.shared.open(userInfo: response.notification.request.content.userInfo)
      completionHandler()
    }
  }

  private func clearNotificationBadge() {
    let center = UNUserNotificationCenter.current()
    center.removeAllDeliveredNotifications()
    center.removeAllPendingNotificationRequests()
    center.setBadgeCount(0) { err in
      if let err {
        log.error("Failed to clear notification badge: \(err.localizedDescription, privacy: .public)")
      }
    }
  }
}

@main
struct OpenCodeApp: App {
  @UIApplicationDelegateAdaptor(AppDelegate.self) private var delegate

  init() {
    log.info("OpenCodeApp.init()")
  }

  var body: some Scene {
    WindowGroup {
      ContentView()
    }
  }
}
