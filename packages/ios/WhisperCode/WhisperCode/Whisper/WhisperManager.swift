import Foundation
import WhisperKit
import os

private nonisolated let log = Logger(subsystem: "opencode", category: "WhisperManager")

struct WhisperStatus {
  let state: String
  let ready: Bool
  let code: String?
  let message: String?

  func payload() -> [String: Any] {
    var value: [String: Any] = [
      "state": state,
      "ready": ready,
    ]
    if let code {
      value["code"] = code
    }
    if let message {
      value["message"] = message
    }
    return value
  }
}

struct WhisperResult {
  let text: String
  let code: String?
  let message: String?
}

actor WhisperManager {
  private enum State: String {
    case prewarming
    case ready
    case error
  }

  static let shared = WhisperManager()
  private var state: State
  private var whisperKit: WhisperKit?
  private var preloadTask: Task<Void, Never>?
  private var code: String?
  private var message: String?

  init() {
    log.info("WhisperManager.init()")
    if #available(iOS 18, *) {
      state = .prewarming
      return
    }
    state = .ready
    log.info("Skipping WhisperKit preload on pre-iOS 18 (using SFSpeechRecognizer fallback)")
  }

  func preload() async {
    guard #available(iOS 18, *) else { return }
    if whisperKit != nil {
      if state != .ready {
        setState(.ready)
      }
      return
    }
    if preloadTask == nil {
      log.info("Scheduling WhisperKit preload task")
      preloadTask = Task(priority: .background) {
        await self._runPreload()
      }
    }
    await preloadTask?.value
  }

  func status() -> WhisperStatus {
    WhisperStatus(
      state: state.rawValue,
      ready: state == .ready,
      code: code,
      message: message,
    )
  }

  private func setState(_ state: State, code: String? = nil, message: String? = nil) {
    self.state = state
    self.code = code
    self.message = message
  }

  private func fail(_ code: String, _ message: String) {
    setState(.error, code: code, message: message)
    log.error("Model error [\(code)]: \(message)")
  }

  private func _runPreload() async {
    await _doPreload()
    preloadTask = nil
  }

  private func _doPreload() async {
    log.info("preload() entered — whisperKit is \(self.whisperKit == nil ? "nil" : "SET")")
    guard whisperKit == nil else {
      log.info("preload() skipped — already loaded")
      setState(.ready)
      return
    }
    do {
      setState(.prewarming)
      log.info("Initializing WhisperKit…")
      let start = CFAbsoluteTimeGetCurrent()
      let loaded = try await Task.detached(priority: .utility) {
        try await WhisperKit(
          WhisperKitConfig(
            model: "openai_whisper-tiny.en",
            prewarm: false,
            load: true,
            download: true,
            useBackgroundDownloadSession: true,
          )
        )
      }.value
      whisperKit = loaded
      let elapsed = CFAbsoluteTimeGetCurrent() - start
      log.info("WhisperKit initialized in \(String(format: "%.1f", elapsed))s")

      if let kit = whisperKit {
        let timings = kit.currentTimings
        log.info(
          """
          WhisperKit timing breakdown: modelLoad=\(String(format: "%.1f", timings.modelLoading))s, tokenizer=\(String(format: "%.1f", timings.tokenizerLoadTime))s, encoder=\(String(format: "%.1f", timings.encoderLoadTime))s, decoder=\(String(format: "%.1f", timings.decoderLoadTime))s
          """
        )
      }
      setState(.ready)
    } catch {
      fail("model_load_failed", "Voice model failed to load.")
      log.error("preload() FAILED: \(String(describing: error), privacy: .public)")
    }
  }

  func transcribe(_ audio: [Float]) async -> WhisperResult {
    // Wait for preload (download/load) to finish before transcribing
    await preload()

    log.info("transcribe() entered — whisperKit is \(self.whisperKit == nil ? "nil" : "SET")")

    let current = status()
    guard current.ready else {
      return WhisperResult(
        text: "",
        code: current.code ?? "not_ready",
        message: current.message ?? "Voice model is still preparing.",
      )
    }

    let maxAmp = audio.map { abs($0) }.max() ?? 0
    let rms = sqrt(audio.map { $0 * $0 }.reduce(0, +) / Float(max(audio.count, 1)))
    log.info("Audio stats: \(audio.count) samples, max=\(String(format: "%.4f", maxAmp)), rms=\(String(format: "%.4f", rms))")

    do {
      guard let kit = whisperKit else {
        fail("model_missing", "Voice model is unavailable.")
        return WhisperResult(
          text: "",
          code: "model_missing",
          message: "Voice model is unavailable.",
        )
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
      return WhisperResult(text: cleaned, code: nil, message: nil)
    } catch {
      log.error("Transcription failed: \(String(describing: error), privacy: .public)")
      return WhisperResult(
        text: "",
        code: "transcription_failed",
        message: "Voice transcription failed.",
      )
    }
  }
}
