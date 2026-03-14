import Foundation
import Security

final class KeychainStore {
  static let shared = KeychainStore()

  private let svc = "opencode.push"

  private init() {}

  func get(_ key: String) -> Data? {
    var query = base(key)
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne

    var item: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &item)
    guard status == errSecSuccess else { return nil }
    return item as? Data
  }

  @discardableResult
  func set(_ value: Data, key: String) -> Bool {
    let query = base(key)
    let attrs = [kSecValueData as String: value]
    let status = SecItemUpdate(query as CFDictionary, attrs as CFDictionary)
    if status == errSecSuccess {
      return true
    }
    if status != errSecItemNotFound {
      return false
    }

    var item = query
    item[kSecValueData as String] = value
    return SecItemAdd(item as CFDictionary, nil) == errSecSuccess
  }

  func remove(_ key: String) {
    SecItemDelete(base(key) as CFDictionary)
  }

  private func base(_ key: String) -> [String: Any] {
    [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: svc,
      kSecAttrAccount as String: key,
      kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
    ]
  }
}
