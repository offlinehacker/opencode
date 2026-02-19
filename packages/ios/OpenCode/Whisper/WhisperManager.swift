import Foundation
import WhisperKit
import os

private let log = Logger(subsystem: "opencode", category: "WhisperManager")

final class WhisperManager {
  private var whisperKit: WhisperKit?

  func transcribe(_ audio: [Float]) async -> String {
    // Log audio levels to verify we're getting real speech data
    let maxAmp = audio.map { abs($0) }.max() ?? 0
    let rms = sqrt(audio.map { $0 * $0 }.reduce(0, +) / Float(max(audio.count, 1)))
    log.info("Audio stats: \(audio.count) samples, max=\(String(format: "%.4f", maxAmp)), rms=\(String(format: "%.4f", rms))")

    do {
      if whisperKit == nil {
        log.info("WhisperKit not initialized — loading model…")
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
      options.compressionRatioThreshold = nil
      options.logProbThreshold = nil

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
