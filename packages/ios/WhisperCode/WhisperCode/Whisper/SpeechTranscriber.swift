import AVFoundation
import Speech
import os

private let log = Logger(subsystem: "opencode", category: "SpeechTranscriber")

final class SpeechTranscriber {
  private func recognizer(localeID: String) -> SFSpeechRecognizer? {
    SFSpeechRecognizer(locale: Locale(identifier: localeID))
  }

  func requestAuthorization() async -> Bool {
    await withCheckedContinuation { continuation in
      SFSpeechRecognizer.requestAuthorization { status in
        let granted = status == .authorized
        log.info("Speech recognition authorization: \(String(describing: status)) (granted=\(granted))")
        continuation.resume(returning: granted)
      }
    }
  }

  func transcribe(_ samples: [Float], localeID: String) async -> String {
    guard let recognizer = recognizer(localeID: localeID), recognizer.isAvailable else {
      log.error("SFSpeechRecognizer unavailable for locale \(localeID)")
      return ""
    }

    let format = AVAudioFormat(
      commonFormat: .pcmFormatFloat32,
      sampleRate: 16000,
      channels: 1,
      interleaved: false
    )!

    guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(samples.count)) else {
      log.error("Failed to create AVAudioPCMBuffer")
      return ""
    }
    buffer.frameLength = AVAudioFrameCount(samples.count)
    let channelData = buffer.floatChannelData![0]
    for i in 0..<samples.count {
      channelData[i] = samples[i]
    }

    let request = SFSpeechAudioBufferRecognitionRequest()
    request.shouldReportPartialResults = false
    if recognizer.supportsOnDeviceRecognition {
      request.requiresOnDeviceRecognition = true
      log.info("Using on-device speech recognition for \(localeID)")
    }
    request.append(buffer)
    request.endAudio()

    log.info("Using SFSpeechRecognizer fallback for \(localeID)")

    return await withCheckedContinuation { continuation in
      recognizer.recognitionTask(with: request) { result, error in
        if let error {
          log.error("SFSpeechRecognizer error: \(error.localizedDescription)")
          continuation.resume(returning: "")
          return
        }
        guard let result, result.isFinal else { return }
        let text = result.bestTranscription.formattedString
        log.info("SFSpeechRecognizer result: \"\(text)\"")
        continuation.resume(returning: text)
      }
    }
  }
}
