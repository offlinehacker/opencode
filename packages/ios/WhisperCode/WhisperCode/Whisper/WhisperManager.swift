import Foundation
import WhisperKit
import os

private let log = Logger(subsystem: "opencode", category: "WhisperManager")

actor WhisperManager {
  static let shared = WhisperManager()
  private var whisperKit: WhisperKit?
  private var preloadTask: Task<Void, Never>?

  var isReady: Bool {
    whisperKit != nil
  }

  init() {
    log.info("WhisperManager.init()")
    if #available(iOS 26, *) {
      preloadTask = Task { await self._doPreload() }
    } else {
      log.info("Skipping WhisperKit preload on pre-iOS 26 (using SFSpeechRecognizer fallback)")
    }
  }

  func preload() async {
    await preloadTask?.value
  }

  private func _doPreload() async {
    log.info("preload() entered — whisperKit is \(self.whisperKit == nil ? "nil" : "SET")")
    guard whisperKit == nil else {
      log.info("preload() skipped — already loaded")
      return
    }
    do {
      log.info("Loading WhisperKit model…")
      let start = CFAbsoluteTimeGetCurrent()
      whisperKit = try await WhisperKit(model: "openai_whisper-base.en")
      let elapsed = CFAbsoluteTimeGetCurrent() - start
      log.info("Model loaded in \(String(format: "%.1f", elapsed))s")

      // Perform warmup inference to force CoreML initialization
      if let kit = whisperKit {
        log.info("Performing warmup inference…")
        var options = DecodingOptions(language: "en")
        options.temperatureFallbackCount = 0
        options.withoutTimestamps = true
        options.wordTimestamps = false
        // 1 second of silence at 16kHz
        let dummyAudio = [Float](repeating: 0, count: 16000)
        let warmupStart = CFAbsoluteTimeGetCurrent()
        _ = try? await kit.transcribe(audioArray: dummyAudio, decodeOptions: options)
        let warmupElapsed = CFAbsoluteTimeGetCurrent() - warmupStart
        log.info("Warmup inference took \(String(format: "%.1f", warmupElapsed))s")
      }
    } catch {
      log.error("preload() FAILED: \(error)")
    }
  }

  func transcribe(_ audio: [Float]) async -> String {
    // Wait for preload (including warmup) to finish before transcribing
    await preloadTask?.value

    log.info("transcribe() entered — whisperKit is \(self.whisperKit == nil ? "nil" : "SET")")

    let maxAmp = audio.map { abs($0) }.max() ?? 0
    let rms = sqrt(audio.map { $0 * $0 }.reduce(0, +) / Float(max(audio.count, 1)))
    log.info("Audio stats: \(audio.count) samples, max=\(String(format: "%.4f", maxAmp)), rms=\(String(format: "%.4f", rms))")

    do {
      if whisperKit == nil {
        log.warning("transcribe() fallback — loading model inline (preload may have failed)…")
        let start = CFAbsoluteTimeGetCurrent()
        whisperKit = try await WhisperKit(model: "openai_whisper-base.en")
        let elapsed = CFAbsoluteTimeGetCurrent() - start
        log.info("WhisperKit model loaded in \(String(format: "%.1f", elapsed))s")

        // Warmup after inline load
        if let kit = whisperKit {
          log.info("Performing warmup inference…")
          var warmupOptions = DecodingOptions(language: "en")
          warmupOptions.temperatureFallbackCount = 0
          warmupOptions.withoutTimestamps = true
          warmupOptions.wordTimestamps = false
          let dummyAudio = [Float](repeating: 0, count: 16000)
          _ = try? await kit.transcribe(audioArray: dummyAudio, decodeOptions: warmupOptions)
        }
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
      let raw = results.map(\.text).joined(separator: " ")
      let cleaned = raw.replacingOccurrences(of: "\\[.*?\\]", with: "", options: .regularExpression)
        .replacingOccurrences(of: "  +", with: " ", options: .regularExpression)
        .trimmingCharacters(in: .whitespacesAndNewlines)
      return cleaned
    } catch {
      log.error("Transcription failed: \(error)")
      return ""
    }
  }
}
