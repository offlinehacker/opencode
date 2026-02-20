import Foundation
import WhisperKit
import os

private let log = Logger(subsystem: "opencode", category: "WhisperManager")

actor WhisperManager {
  static let shared = WhisperManager()
  private var whisperKit: WhisperKit?

  init() {
    log.warning("[PRELOAD-DEBUG] WhisperManager.init() called — instance \(ObjectIdentifier(self).debugDescription)")
    Task {
      await preload()
    }
  }

  func preload() async {
    log.warning("[PRELOAD-DEBUG] preload() entered — whisperKit is \(self.whisperKit == nil ? "nil" : "SET"), instance \(ObjectIdentifier(self).debugDescription)")
    guard whisperKit == nil else {
      log.warning("[PRELOAD-DEBUG] preload() skipped — already loaded")
      return
    }
    do {
      log.warning("[PRELOAD-DEBUG] preload() loading WhisperKit model…")
      let start = CFAbsoluteTimeGetCurrent()
      whisperKit = try await WhisperKit(model: "openai_whisper-base.en")
      let elapsed = CFAbsoluteTimeGetCurrent() - start
      log.warning("[PRELOAD-DEBUG] preload() done — model loaded in \(String(format: "%.1f", elapsed))s, whisperKit is \(self.whisperKit == nil ? "nil" : "SET")")
    } catch {
      log.error("[PRELOAD-DEBUG] preload() FAILED: \(error)")
    }
  }

  func transcribe(_ audio: [Float]) async -> String {
    log.warning("[PRELOAD-DEBUG] transcribe() entered — whisperKit is \(self.whisperKit == nil ? "nil" : "SET"), instance \(ObjectIdentifier(self).debugDescription)")

    // Log audio levels to verify we're getting real speech data
    let maxAmp = audio.map { abs($0) }.max() ?? 0
    let rms = sqrt(audio.map { $0 * $0 }.reduce(0, +) / Float(max(audio.count, 1)))
    log.info("Audio stats: \(audio.count) samples, max=\(String(format: "%.4f", maxAmp)), rms=\(String(format: "%.4f", rms))")

    do {
      if whisperKit == nil {
        log.warning("[PRELOAD-DEBUG] transcribe() fallback — loading model inline…")
        let start = CFAbsoluteTimeGetCurrent()
        whisperKit = try await WhisperKit(model: "openai_whisper-base.en")
        let elapsed = CFAbsoluteTimeGetCurrent() - start
        log.info("WhisperKit model loaded in \(String(format: "%.1f", elapsed))s")
      }
      guard let kit = whisperKit else {
        log.error("WhisperKit is nil after init")
        return ""
      }

      var options = DecodingOptions(language: "en")
      options.temperatureFallbackCount = 3
      options.withoutTimestamps = true
      options.wordTimestamps = false

      log.info("Transcribing \(audio.count) samples…")
      let start = CFAbsoluteTimeGetCurrent()
      let results = try await kit.transcribe(audioArray: audio, decodeOptions: options)
      let elapsed = CFAbsoluteTimeGetCurrent() - start
      log.info("Transcription took \(String(format: "%.1f", elapsed))s, got \(results.count) result(s)")
      for (i, r) in results.enumerated() {
        log.info("  result[\(i)]: \"\(r.text)\"")
      }
      return results.map(\.text).joined(separator: " ").trimmingCharacters(in: .whitespacesAndNewlines)
    } catch {
      log.error("Transcription failed: \(error)")
      return ""
    }
  }
}
