import Foundation

final class WhisperBridge {
  var onEvent: (([String: Any]) -> Void)?
  private let recorder = AudioRecorder()
  private let manager = WhisperManager()

  func start() {
    recorder.start()
  }

  func stop(completion: @escaping (String) -> Void) {
    recorder.stop()
    completion("")
  }
}
