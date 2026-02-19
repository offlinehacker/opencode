import SwiftUI
import os

private let log = Logger(subsystem: "opencode", category: "OpenCodeApp")

@main
struct OpenCodeApp: App {
  init() {
    log.warning("[PRELOAD-DEBUG] OpenCodeApp.init() called on thread=\(Thread.current)")
    Task {
      log.warning("[PRELOAD-DEBUG] Task started, about to call preload()")
      await WhisperManager.shared.preload()
      log.warning("[PRELOAD-DEBUG] preload() returned")
    }
    log.warning("[PRELOAD-DEBUG] OpenCodeApp.init() finished (Task fired)")
  }

  var body: some Scene {
    WindowGroup {
      ContentView()
    }
  }
}
