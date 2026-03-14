import Foundation

final class ServerConfig {
  private let defaults = UserDefaults.standard
  private let defaultServerKey = "opencode.defaultServerUrl"
  private let pushRelayKey = "opencode.pushRelayUrl"
  private let storagePrefix = "opencode.storage."

  func getDefaultServerUrl() -> String? {
    defaults.string(forKey: defaultServerKey)
  }

  func setDefaultServerUrl(_ url: String?) {
    if let url {
      defaults.set(url, forKey: defaultServerKey)
      return
    }
    defaults.removeObject(forKey: defaultServerKey)
  }

  func getPushRelayUrl() -> String? {
    defaults.string(forKey: pushRelayKey)
  }

  func setPushRelayUrl(_ url: String?) {
    if let url {
      defaults.set(url, forKey: pushRelayKey)
      return
    }
    defaults.removeObject(forKey: pushRelayKey)
  }

  func storageGet(name: String?, key: String?) -> String? {
    guard let key = storageKey(name: name, key: key) else { return nil }
    return defaults.string(forKey: key)
  }

  func storageSet(name: String?, key: String?, value: String?) {
    guard let key = storageKey(name: name, key: key) else { return }
    if let value {
      defaults.set(value, forKey: key)
      return
    }
    defaults.removeObject(forKey: key)
  }

  func storageRemove(name: String?, key: String?) {
    guard let key = storageKey(name: name, key: key) else { return }
    defaults.removeObject(forKey: key)
  }

  func storageClear(name: String?) {
    guard let name else { return }
    let prefix = storagePrefix + name + ":"
    for key in defaults.dictionaryRepresentation().keys where key.hasPrefix(prefix) {
      defaults.removeObject(forKey: key)
    }
  }

  func storageKey(name: String?, index: Int?) -> String? {
    guard let name, let index else { return nil }
    let keys = storageKeys(name: name)
    guard index >= 0 && index < keys.count else { return nil }
    return keys[index]
  }

  func storageLength(name: String?) -> Int {
    guard let name else { return 0 }
    return storageKeys(name: name).count
  }

  private func storageKeys(name: String) -> [String] {
    let prefix = storagePrefix + name + ":"
    return defaults.dictionaryRepresentation().keys
      .filter { $0.hasPrefix(prefix) }
      .map { String($0.dropFirst(prefix.count)) }
      .sorted()
  }

  private func storageKey(name: String?, key: String?) -> String? {
    guard let name, let key else { return nil }
    return storagePrefix + name + ":" + key
  }
}
