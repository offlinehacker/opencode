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
    return true
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
    completionHandler([.banner, .list, .sound, .badge])
  }

  func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    didReceive response: UNNotificationResponse,
    withCompletionHandler completionHandler: @escaping () -> Void
  ) {
    Task { @MainActor in
      PushBridge.shared.open(userInfo: response.notification.request.content.userInfo)
      completionHandler()
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
