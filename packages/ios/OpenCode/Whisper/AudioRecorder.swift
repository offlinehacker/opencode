import AVFoundation
import Accelerate
import os

private let log = Logger(subsystem: "opencode", category: "AudioRecorder")

/// Thread-safe buffer for audio samples collected from AVAudioEngine tap.
/// Marked `nonisolated` to opt out of the project-wide implicit @MainActor,
/// since the tap closure is @Sendable and runs on the audio thread.
nonisolated final class AudioBuffer: @unchecked Sendable {
  private var samples: [Float] = []
  private let lock = NSLock()
  private var tapCount = 0

  func append(_ buffer: AVAudioPCMBuffer) {
    guard let channelData = buffer.floatChannelData else { return }
    let count = Int(buffer.frameLength)
    let pointer = channelData[0]
    lock.lock()
    samples.append(contentsOf: UnsafeBufferPointer(start: pointer, count: count))
    tapCount += 1
    lock.unlock()
  }

  func drain() -> [Float] {
    lock.lock()
    let result = samples
    let taps = tapCount
    samples = []
    tapCount = 0
    lock.unlock()
    log.info("drain(): \(result.count) samples from \(taps) tap callbacks")
    return result
  }

  func reset() {
    lock.lock()
    samples = []
    tapCount = 0
    lock.unlock()
  }
}

/// Result from stopping the recorder: raw samples + the sample rate they were captured at.
struct RecordingResult {
  let samples: [Float]
  let sampleRate: Double
}

final class AudioRecorder {
  private let engine = AVAudioEngine()
  private let audioBuffer = AudioBuffer()
  private var isRecording = false
  private var recordingSampleRate: Double = 0

  /// Returns `true` if recording started successfully.
  @discardableResult
  func start() -> Bool {
    guard !isRecording else { return true }
    audioBuffer.reset()

    // Configure audio session for recording — without this, iOS delivers
    // silent buffers even though the mic indicator is active.
    do {
      let session = AVAudioSession.sharedInstance()
      try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker])
      try session.setActive(true)
      log.info("Audio session activated")
    } catch {
      log.error("Failed to configure audio session: \(error)")
      return false
    }

    let inputNode = engine.inputNode
    let hwFormat = inputNode.outputFormat(forBus: 0)
    log.info("Hardware format: \(hwFormat.channelCount) ch, \(hwFormat.sampleRate) Hz")

    // Simulator (or device with no mic) can report 0 ch / 0 Hz.
    guard hwFormat.channelCount > 0, hwFormat.sampleRate > 0 else {
      log.error("No valid audio input — aborting")
      return false
    }

    recordingSampleRate = hwFormat.sampleRate

    inputNode.installTap(onBus: 0, bufferSize: 4096, format: nil) { [audioBuffer] buffer, _ in
      audioBuffer.append(buffer)
    }

    do {
      try engine.start()
      isRecording = true
      log.info("Engine started — recording")
      return true
    } catch {
      log.error("Failed to start engine: \(error)")
      inputNode.removeTap(onBus: 0)
      return false
    }
  }

  func stop() -> RecordingResult {
    guard isRecording else {
      log.warning("stop() called but not recording")
      return RecordingResult(samples: [], sampleRate: 0)
    }
    engine.inputNode.removeTap(onBus: 0)
    engine.stop()
    isRecording = false
    log.info("Engine stopped")
    let samples = audioBuffer.drain()
    return RecordingResult(samples: samples, sampleRate: recordingSampleRate)
  }

  /// Resample audio to 16 kHz for Whisper.
  static func resampleTo16kHz(_ recording: RecordingResult) -> [Float] {
    let sourceSampleRate = recording.sampleRate
    let samples = recording.samples
    guard !samples.isEmpty, sourceSampleRate > 0 else { return [] }

    if abs(sourceSampleRate - 16000) < 1 {
      log.info("Already at 16 kHz — no resampling needed")
      return samples
    }

    let ratio = 16000.0 / sourceSampleRate
    let outputCount = Int(Double(samples.count) * ratio)
    var output = [Float](repeating: 0, count: outputCount)

    // Use vDSP linear interpolation for resampling
    var control = (0..<outputCount).map { Float(Double($0) / ratio) }
    // Clamp control values to valid range
    let maxIndex = Float(samples.count - 1)
    for i in 0..<outputCount {
      if control[i] >= maxIndex { control[i] = maxIndex }
    }
    vDSP_vlint(samples, &control, 1, &output, 1, vDSP_Length(outputCount), vDSP_Length(samples.count))

    log.info("Resampled \(samples.count) samples @ \(String(format: "%.0f", sourceSampleRate)) Hz → \(outputCount) samples @ 16000 Hz")
    return output
  }
}
