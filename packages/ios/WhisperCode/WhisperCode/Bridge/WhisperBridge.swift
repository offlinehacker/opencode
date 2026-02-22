import AVFoundation
import os

private let log = Logger(subsystem: "opencode", category: "WhisperBridge")

@MainActor
final class WhisperBridge {
  private enum State: String {
    case prewarming
    case ready
    case recording
    case processing
    case error
  }

  var onState: (([String: Any]) -> Void)? {
    didSet {
      onState?(payload())
    }
  }
  private let recorder = AudioRecorder()
  private var speechTranscriber: SpeechTranscriber?
  private var state: State
  private var message: String?
  private var preloading = false

  private var manager: WhisperManager {
    WhisperManager.shared
  }

  private func speech() -> SpeechTranscriber {
    if let speechTranscriber {
      return speechTranscriber
    }
    let speechTranscriber = SpeechTranscriber()
    self.speechTranscriber = speechTranscriber
    return speechTranscriber
  }

  init() {
    if #available(iOS 18, *) {
      state = .prewarming
    } else {
      state = .ready
    }
  }

  private func preload() {
    guard #available(iOS 18, *) else { return }
    guard !preloading else { return }
    preloading = true
    Task.detached(priority: .background) { [weak self] in
      // Let WebKit finish bringing up content before heavy model work starts.
      try? await Task.sleep(nanoseconds: 1_000_000_000)
      await WhisperManager.shared.preload()
      await self?.finishPreload()
    }
  }

  private func finishPreload() async {
    preloading = false
    await sync()
  }

  func beginPreload() {
    preload()
  }

  private func payload() -> [String: Any] {
    var value: [String: Any] = [
      "state": state.rawValue,
      "ready": state == .ready,
    ]
    if let message {
      value["message"] = message
    }
    return value
  }

  private func set(_ state: State, message: String? = nil) {
    let changed = self.state != state || self.message != message
    self.state = state
    self.message = message
    if changed {
      onState?(payload())
    }
  }

  private func fail(code: String, message: String) -> [String: Any] {
    [
      "ok": false,
      "code": code,
      "message": message,
    ]
  }

  private func speechStop(_ samples: [Float]) async -> [String: Any] {
    log.info("Using SFSpeechRecognizer fallback")
    let speechGranted = await speech().requestAuthorization()
    log.info("Speech recognition permission granted=\(speechGranted)")
    guard speechGranted else {
      set(.ready)
      return fail(code: "speech_permission_denied", message: "Speech recognition permission is required for voice input.")
    }

    let text = await speech().transcribe(samples)
    set(.ready)
    guard !text.isEmpty else {
      return fail(code: "transcription_failed", message: "Voice transcription failed.")
    }
    log.info("Transcription result: \"\(text)\"")
    return ["text": text]
  }

  private func sync(force: Bool = false) async {
    guard #available(iOS 18, *) else {
      set(.ready)
      return
    }
    if !force {
      guard state != .recording, state != .processing else { return }
    } else {
      guard state != .recording else { return }
    }
    let value = await manager.status()
    switch value.state {
    case "ready":
      set(.ready)
    case "error":
      set(.ready)
    default:
      set(.prewarming, message: value.message)
    }
  }

  func status() async -> [String: Any] {
    return payload()
  }

  func start() async -> [String: Any] {
    log.info("start() called — state=\(self.state.rawValue)")
    guard state != .recording, state != .processing else {
      log.warning("start() ignored — already recording or transcribing")
      return fail(code: "already_recording", message: "Voice input is already active.")
    }

    log.info("Requesting mic permission…")
    let granted = await AVAudioApplication.requestRecordPermission()
    log.info("Mic permission granted=\(granted)")
    guard granted else {
      return fail(code: "mic_permission_denied", message: "Microphone permission is required for voice input.")
    }

    if #unavailable(iOS 18) {
      let speechGranted = await speech().requestAuthorization()
      log.info("Speech recognition permission granted=\(speechGranted)")
      guard speechGranted else {
        return fail(code: "speech_permission_denied", message: "Speech recognition permission is required for voice input.")
      }
    }

    let ok = recorder.start()
    log.info("recorder.start() returned \(ok)")
    guard ok else {
      return fail(code: "recorder_start_failed", message: "Failed to start microphone recording.")
    }

    set(.recording)
    preload()
    return ["ok": true]
  }

  func stop() async -> [String: Any] {
    log.info("stop() called — state=\(self.state.rawValue)")
    guard state == .recording else {
      log.warning("stop() bailing early — not recording")
      return [
        "text": "",
        "code": "not_recording",
        "message": "Voice input is not currently recording.",
      ]
    }
    set(.processing)

    let recording = recorder.stop()
    log.info("recorder.stop() returned \(recording.samples.count) samples @ \(String(format: "%.0f", recording.sampleRate)) Hz")

    guard !recording.samples.isEmpty else {
      log.warning("No samples captured")
      await sync(force: true)
      return [
        "text": "",
        "code": "empty_recording",
        "message": "No audio was captured.",
      ]
    }

    // Resample to 16 kHz for Whisper
    let samples16k = AudioRecorder.resampleTo16kHz(recording)
    log.info("Passing \(samples16k.count) samples (16 kHz) to transcriber")

    if #available(iOS 18, *) {
      log.info("Using WhisperKit transcriber (iOS 18+)")
      let result = await manager.transcribe(samples16k)
      if let code = result.code {
        log.warning("WhisperKit failed [\(code)]; using SFSpeechRecognizer fallback")
        return await speechStop(samples16k)
      }
      await sync(force: true)
      log.info("Transcription result: \"\(result.text)\"")
      return ["text": result.text]
    }

    return await speechStop(samples16k)
  }
}
