import Foundation
import UIKit
import UserNotifications

@MainActor
final class PushBridge {
  static let shared = PushBridge()

  var onEvent: ((String, Any?) -> Void)?

  private let center = UNUserNotificationCenter.current()
  private let keychain = KeychainStore.shared
  private let config = ServerConfig()
  private let pendingKey = "opencode.push.pending"
  private let tokenKey = "opencode.push.apns"
  private let channelKey = "opencode.push.channel"
  private let deviceKey = "opencode.push.device"
  private let secretKey = "opencode.push.secret"
  private let pairIDKey = "opencode.push.pair.id"
  private let pairCmdKey = "opencode.push.pair.cmd"
  private let pairExpKey = "opencode.push.pair.exp"
  private var last: String?

  private init() {}

  func state() async -> [String: Any] {
    let perm = await permission()
    if perm.allowed {
      register()
    }
    let channel = channel()
    var next: [String: Any] = [
      "supported": true,
      "permission": perm.rawValue,
      "allowed": perm.allowed,
      "registered": token() != nil,
      "paired": paired(),
      "generic": true,
    ]
    if let channel {
      next["channel"] = channel
    }
    return next
  }

  func refresh(emit: Bool = false) async -> [String: Any] {
    let next = await state()
    let stamp = [
      next["permission"] as? String ?? "",
      (next["registered"] as? Bool) == true ? "registered" : "unregistered",
      (next["paired"] as? Bool) == true ? "paired" : "unpaired",
      next["channel"] as? String ?? "",
    ].joined(separator: ":")
    let changed = stamp != last
    last = stamp
    if emit, changed {
      onEvent?("pushStateChanged", next)
    }
    return next
  }

  func request() async -> [String: Any] {
    await requestAuth()
    return await refresh(emit: true)
  }

  func notify(title: String?, body: String?, href: String?, kind: String?, generic: Bool, force: Bool = false) async -> Bool {
    let next = await refresh()
    guard (next["allowed"] as? Bool) == true else { return false }
    if !force, UIApplication.shared.applicationState == .active { return false }

    let copy = text(kind: kind, title: title, body: body, generic: generic)
    let content = UNMutableNotificationContent()
    content.title = copy.title
    content.body = copy.body
    content.sound = .default
    content.threadIdentifier = "opencode"
    content.badge = 1
    if let data = payload(href: href, kind: kind) {
      content.userInfo = data
    }

    let trig = UNTimeIntervalNotificationTrigger(timeInterval: 1, repeats: false)
    let req = UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: trig)
    return await add(req)
  }

  func test(href: String?) async throws -> Bool {
    if paired() {
      let result: DeviceTestRes = try await send(path: "/v1/device/test", method: "POST", body: auth())
      return result.sent == true && result.accepted
    }
    return await notify(title: nil, body: nil, href: href, kind: "test", generic: true, force: true)
  }

  func open(userInfo: [AnyHashable: Any]) {
    guard let next = normalize(userInfo) else { return }
    if let onEvent {
      onEvent("pushOpened", next)
      return
    }
    save(next, key: pendingKey)
  }

  func consume() -> [String: String]? {
    let next: [String: String]? = load(pendingKey)
    keychain.remove(pendingKey)
    return next
  }

  func tokenDidUpdate(_ data: Data) {
    let text = data.map { String(format: "%02x", $0) }.joined()
    guard !text.isEmpty else { return }
    _ = keychain.set(Data(text.utf8), key: tokenKey)
    Task { @MainActor in
      if paired() {
        try? await putToken(text)
      }
      _ = await refresh(emit: true)
    }
  }

  func tokenDidFail() {
    keychain.remove(tokenKey)
    Task { @MainActor in
      _ = await refresh(emit: true)
    }
  }

  func setCredentials(channel: String?, device: String?, secret: String?) async -> [String: Any] {
    if let channel, !channel.isEmpty {
      save(channel, key: channelKey)
    } else {
      keychain.remove(channelKey)
    }
    if let device, !device.isEmpty {
      save(device, key: deviceKey)
    } else {
      keychain.remove(deviceKey)
    }
    if let secret, !secret.isEmpty {
      save(secret, key: secretKey)
    } else {
      keychain.remove(secretKey)
    }
    return await refresh(emit: true)
  }

  func clearPairing() async throws -> [String: Any] {
    if paired() {
      try await deleteDevice()
    }
    clearCredentials()
    clearPendingPair()
    return await refresh(emit: true)
  }

  func setPrefs(complete: Bool, approval: Bool, question: Bool, error: Bool) async throws {
    guard paired() else { return }
    let value = auth()
    let body = DevicePrefsReq(
      channel_id: value.channel_id,
      device_id: value.device_id,
      device_secret: value.device_secret,
      prefs: DevicePrefs(complete: complete, approval: approval, question: question, error: error)
    )
    let _: DevicePrefsRes = try await send(path: "/v1/device/preferences", method: "PUT", body: body)
  }

  func setRelayURL(_ url: String?) {
    config.setPushRelayUrl(url)
  }

  func beginPair(version: String?) async throws -> [String: Any] {
    guard let token = token(), !token.isEmpty else {
      throw PushErr.missingToken
    }

    let req = PairStartReq(
      apns_token: token,
      device_name: UIDevice.current.name,
      app_version: version ?? "unknown"
    )
    let res: PairStartRes = try await send(path: "/v1/pair/start", method: "POST", body: req)
    save(res.pair_id, key: pairIDKey)
    save(res.install_command, key: pairCmdKey)
    save(res.expires_at, key: pairExpKey)
    return pair(
      id: res.pair_id,
      status: "pending",
      command: res.install_command,
      expires: res.expires_at,
      channel: nil,
      device: nil,
      message: nil
    )
  }

  func getPair() async throws -> [String: Any]? {
    if paired() {
      return pair(
        id: text(pairIDKey),
        status: "active",
        command: nil,
        expires: nil,
        channel: channel(),
        device: device(),
        message: nil
      )
    }

    guard let id = text(pairIDKey), !id.isEmpty else { return nil }
    let command = text(pairCmdKey)
    let expires = text(pairExpKey)
    let path = "/v1/pair/\(id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id)"
    let res: PairPollRes = try await send(path: path, method: "GET")

    switch res.status {
    case "active":
      guard let channel = res.channel_id,
            let device = res.device_id,
            let secret = res.device_secret else {
        throw PushErr.badPair
      }
      _ = await setCredentials(channel: channel, device: device, secret: secret)
      clearPendingPair()
      return pair(
        id: id,
        status: "active",
        command: nil,
        expires: nil,
        channel: channel,
        device: device,
        message: nil
      )
    case "expired", "failed":
      clearPendingPair()
      return pair(
        id: id,
        status: res.status,
        command: command,
        expires: expires,
        channel: nil,
        device: nil,
        message: res.message
      )
    default:
      return pair(
        id: id,
        status: res.status,
        command: command,
        expires: expires,
        channel: nil,
        device: nil,
        message: res.message
      )
    }
  }

  private func requestAuth() async {
    await withCheckedContinuation { cont in
      center.requestAuthorization(options: [.alert, .badge, .sound]) { _, _ in
        cont.resume()
      }
    }
    register()
  }

  private func settings() async -> UNNotificationSettings {
    await withCheckedContinuation { cont in
      center.getNotificationSettings { settings in
        cont.resume(returning: settings)
      }
    }
  }

  private func add(_ req: UNNotificationRequest) async -> Bool {
    await withCheckedContinuation { cont in
      center.add(req) { err in
        cont.resume(returning: err == nil)
      }
    }
  }

  private func permission() async -> PushPerm {
    let settings = await settings()
    switch settings.authorizationStatus {
    case .notDetermined:
      return .notDetermined
    case .denied:
      return .denied
    case .authorized:
      return .authorized
    case .provisional:
      return .provisional
    case .ephemeral:
      return .ephemeral
    @unknown default:
      return .unsupported
    }
  }

  private func register() {
    UIApplication.shared.registerForRemoteNotifications()
  }

  private func token() -> String? {
    guard let data = keychain.get(tokenKey) else { return nil }
    return String(data: data, encoding: .utf8)
  }

  private func channel() -> String? {
    text(channelKey)
  }

  private func device() -> String? {
    text(deviceKey)
  }

  private func secret() -> String? {
    text(secretKey)
  }

  private func paired() -> Bool {
    channel() != nil && device() != nil && secret() != nil
  }

  private func save(_ value: [String: String], key: String) {
    guard let data = try? JSONEncoder().encode(value) else { return }
    _ = keychain.set(data, key: key)
  }

  private func save(_ value: String, key: String) {
    _ = keychain.set(Data(value.utf8), key: key)
  }

  private func load<T: Decodable>(_ key: String) -> T? {
    guard let data = keychain.get(key) else { return nil }
    return try? JSONDecoder().decode(T.self, from: data)
  }

  private func text(_ key: String) -> String? {
    guard let data = keychain.get(key) else { return nil }
    return String(data: data, encoding: .utf8)
  }

  private func payload(href _: String?, kind _: String?) -> [AnyHashable: Any]? {
    nil
  }

  private func normalize(_ userInfo: [AnyHashable: Any]) -> [String: String]? {
    var next = [String: String]()
    if let href = userInfo["href"] as? String, !href.isEmpty {
      next["href"] = href
    }
    if let channel = userInfo["channel_id"] as? String, !channel.isEmpty {
      next["channel_id"] = channel
    }
    if let session = userInfo["session_id"] as? String, !session.isEmpty {
      next["session_id"] = session
    }
    if let kind = userInfo["kind"] as? String, !kind.isEmpty {
      next["kind"] = kind
    }
    return next.isEmpty ? nil : next
  }

  private func text(kind: String?, title: String?, body: String?, generic: Bool) -> (title: String, body: String) {
    if generic {
      switch kind {
      case "complete", "error", "approval", "question":
        return ("OpenCode", "Session needs attention")
      case "test":
        return ("OpenCode", "Test notification")
      default:
        return ("OpenCode", "Session needs attention")
      }
    }
    return (title ?? "OpenCode", body ?? "")
  }

  private func clearPendingPair() {
    keychain.remove(pairIDKey)
    keychain.remove(pairCmdKey)
    keychain.remove(pairExpKey)
  }

  private func clearCredentials() {
    keychain.remove(channelKey)
    keychain.remove(deviceKey)
    keychain.remove(secretKey)
  }

  private func pair(
    id: String?,
    status: String,
    command: String?,
    expires: String?,
    channel: String?,
    device: String?,
    message: String?
  ) -> [String: Any] {
    var next: [String: Any] = [
      "status": status,
    ]
    if let id, !id.isEmpty {
      next["id"] = id
    }
    if let command, !command.isEmpty {
      next["command"] = command
    }
    if let expires, !expires.isEmpty {
      next["expires"] = expires
    }
    if let channel, !channel.isEmpty {
      next["channel"] = channel
    }
    if let device, !device.isEmpty {
      next["device"] = device
    }
    if let message, !message.isEmpty {
      next["message"] = message
    }
    return next
  }

  private func send<T: Decodable>(path: String, method: String) async throws -> T {
    try await request(path: path, method: method)
  }

  private func send<T: Decodable, Body: Encodable>(path: String, method: String, body: Body) async throws -> T {
    try await request(path: path, method: method, body: body)
  }

  private func auth() -> DeviceAuthReq {
    DeviceAuthReq(
      channel_id: channel() ?? "",
      device_id: device() ?? "",
      device_secret: secret() ?? ""
    )
  }

  private func putToken(_ token: String) async throws {
    guard paired() else { return }
    let value = auth()
    let body = DeviceTokenReq(
      channel_id: value.channel_id,
      device_id: value.device_id,
      device_secret: value.device_secret,
      apns_token: token
    )
    let _: DeviceTokenRes = try await send(path: "/v1/device/token", method: "PUT", body: body)
  }

  private func deleteDevice() async throws {
    let _: DeviceDeleteRes = try await send(path: "/v1/device", method: "DELETE", body: auth())
  }

  private func request<T: Decodable>(path: String, method: String) async throws -> T {
    let root = relay()
    guard let base = URL(string: root), let url = URL(string: path, relativeTo: base) else {
      throw PushErr.badRelay
    }

    var req = URLRequest(url: url)
    req.httpMethod = method
    req.setValue("application/json", forHTTPHeaderField: "Accept")

    let (data, response) = try await URLSession.shared.data(for: req)
    return try parse(data: data, response: response)
  }

  private func request<T: Decodable, Body: Encodable>(path: String, method: String, body: Body) async throws -> T {
    let root = relay()
    guard let base = URL(string: root), let url = URL(string: path, relativeTo: base) else {
      throw PushErr.badRelay
    }

    var req = URLRequest(url: url)
    req.httpMethod = method
    req.setValue("application/json", forHTTPHeaderField: "Accept")
    req.httpBody = try JSONEncoder().encode(body)
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")

    let (data, response) = try await URLSession.shared.data(for: req)
    return try parse(data: data, response: response)
  }

  private func parse<T: Decodable>(data: Data, response: URLResponse) throws -> T {
    guard let http = response as? HTTPURLResponse else {
      throw PushErr.badReply
    }
    guard (200..<300).contains(http.statusCode) else {
      let err = try? JSONDecoder().decode(RelayErr.self, from: data)
      throw PushErr.relay(err?.error ?? err?.message ?? "HTTP \(http.statusCode)")
    }
    do {
      return try JSONDecoder().decode(T.self, from: data)
    } catch {
      throw PushErr.decode
    }
  }

  private func relay() -> String {
    config.getPushRelayUrl() ??
      (Bundle.main.object(forInfoDictionaryKey: "WhisperCodePushRelayURL") as? String ?? "https://push.whispercode.dev")
  }
}

private enum PushPerm: String {
  case unsupported
  case notDetermined = "not-determined"
  case denied
  case authorized
  case provisional
  case ephemeral

  var allowed: Bool {
    switch self {
    case .authorized, .provisional, .ephemeral:
      return true
    default:
      return false
    }
  }
}

private struct PairStartReq: Encodable {
  let apns_token: String
  let device_name: String
  let app_version: String
}

private struct PairStartRes: Decodable {
  let pair_id: String
  let pair_token: String?
  let expires_at: String
  let install_command: String
}

private struct PairPollRes: Decodable {
  let status: String
  let channel_id: String?
  let device_id: String?
  let device_secret: String?
  let error: String?
  let message: String?
}

private struct RelayErr: Decodable {
  let error: String?
  let message: String?
}

private struct DeviceAuthReq: Encodable {
  let channel_id: String
  let device_id: String
  let device_secret: String
}

private struct DeviceTokenReq: Encodable {
  let channel_id: String
  let device_id: String
  let device_secret: String
  let apns_token: String
}

private struct DevicePrefsReq: Encodable {
  let channel_id: String
  let device_id: String
  let device_secret: String
  let prefs: DevicePrefs
}

private struct DevicePrefs: Encodable {
  let complete: Bool
  let approval: Bool
  let question: Bool
  let error: Bool
}

private struct DeviceTokenRes: Decodable {
  let ok: Bool
}

private struct DevicePrefsRes: Decodable {
  let ok: Bool
}

private struct DeviceTestRes: Decodable {
  let accepted: Bool
  let sent: Bool?
}

private struct DeviceDeleteRes: Decodable {
  let ok: Bool
}

private enum PushErr: Error, LocalizedError {
  case missingToken
  case badRelay
  case badReply
  case badPair
  case decode
  case relay(String)

  var errorDescription: String? {
    switch self {
    case .missingToken:
      return "APNs token unavailable"
    case .badRelay:
      return "Push relay URL is invalid"
    case .badReply:
      return "Push relay returned an invalid response"
    case .badPair:
      return "Push relay pairing response was incomplete"
    case .decode:
      return "Push relay response could not be decoded"
    case .relay(let message):
      return message
    }
  }
}
