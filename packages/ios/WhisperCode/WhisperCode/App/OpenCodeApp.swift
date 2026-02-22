import SwiftUI
import os

private let log = Logger(subsystem: "opencode", category: "OpenCodeApp")

@main
struct OpenCodeApp: App {
  init() {
    log.info("OpenCodeApp.init() — triggering WhisperManager singleton")
    _ = WhisperManager.shared
  }

  var body: some Scene {
    WindowGroup {
      ContentView()
    }
  }
}
