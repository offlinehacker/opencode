import AVFoundation
import os

private let log = Logger(subsystem: "opencode", category: "WhisperBridge")

final class WhisperBridge {
  var onEvent: (([String: Any]) -> Void)?
  private let recorder = AudioRecorder()
  private let manager = WhisperManager.shared
  private var isRecording = false
  private var isTranscribing = false

  func start() {
    log.info("start() called — isRecording=\(self.isRecording), isTranscribing=\(self.isTranscribing)")
    guard !isRecording, !isTranscribing else {
      log.warning("start() ignored — already recording or transcribing")
      return
    }
    Task {
      log.info("Requesting mic permission…")
      let granted = await AVAudioApplication.requestRecordPermission()
      log.info("Mic permission granted=\(granted)")
      guard granted else { return }
      let ok = self.recorder.start()
      log.info("recorder.start() returned \(ok)")
      self.isRecording = ok
    }
  }

  func stop(completion: @escaping (String) -> Void) {
    log.info("stop() called — isRecording=\(self.isRecording), isTranscribing=\(self.isTranscribing)")
    guard isRecording, !isTranscribing else {
      log.warning("stop() bailing early — not recording or already transcribing")
      completion("")
      return
    }
    isRecording = false
    isTranscribing = true
    let recording = recorder.stop()
    log.info("recorder.stop() returned \(recording.samples.count) samples @ \(String(format: "%.0f", recording.sampleRate)) Hz")

    guard !recording.samples.isEmpty else {
      log.warning("No samples captured — returning empty string")
      isTranscribing = false
      completion("")
      return
    }

    // Resample to 16 kHz for Whisper
    let samples16k = AudioRecorder.resampleTo16kHz(recording)
    log.info("Passing \(samples16k.count) samples (16 kHz) to transcriber")

    Task {
      let text = await manager.transcribe(samples16k)
      log.info("Transcription result: \"\(text)\"")
      self.isTranscribing = false
      completion(text)
    }
  }
}
