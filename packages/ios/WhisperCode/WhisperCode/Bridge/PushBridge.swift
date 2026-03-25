import Foundation
import UIKit
import UserNotifications

@MainActor
final class PushBridge {
  static let shared = PushBridge()
  private static let reqTimeout: TimeInterval = 10
  private static let resTimeout: TimeInterval = 15

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
  private let pairTokKey = "opencode.push.pair.tok"
  private let pairCmdKey = "opencode.push.pair.cmd"
  private let pairExpKey = "opencode.push.pair.exp"
  private let tokenPendingKey = "opencode.push.token.pending"
  private var last: String?
  private var perm: PushPerm?
  private var task: Task<[String: Any], Never>?
  private var emit = false
  private var didRegister = false
  private var registerAt = Date.distantPast
  private let registerGap: TimeInterval = 30
  private var pollTask: Task<[String: Any]?, Error>?
  private var pollAt = Date.distantPast
  private var pollLast: [String: Any]?
  private let pollGap: TimeInterval = 5
  private var lastCode: String?
  private var lastErr: String?
  private let session: URLSession = {
    let cfg = URLSessionConfiguration.default
    cfg.timeoutIntervalForRequest = PushBridge.reqTimeout
    cfg.timeoutIntervalForResource = PushBridge.resTimeout
    cfg.requestCachePolicy = .reloadIgnoringLocalCacheData
    cfg.urlCache = nil
    return URLSession(configuration: cfg)
  }()

  private static var apnsEnv: String {
    #if targetEnvironment(simulator)
    return "sandbox"
    #else
    // embedded.mobileprovision exists in Xcode builds but is stripped
    // from TestFlight/App Store builds. Read its aps-environment to
    // determine sandbox vs production. Use isoLatin1 because the file
    // is binary CMS with an embedded ASCII plist.
    guard let url = Bundle.main.url(forResource: "embedded", withExtension: "mobileprovision"),
          let data = try? Data(contentsOf: url),
          let text = String(data: data, encoding: .isoLatin1) else {
      return "production"
    }
    guard let range = text.range(of: "<key>aps-environment</key>") else {
      return "production"
    }
    let after = text[range.upperBound...]
    if let valStart = after.range(of: "<string>"),
       let valEnd = after.range(of: "</string>"),
       valStart.upperBound < valEnd.lowerBound {
      let value = text[valStart.upperBound..<valEnd.lowerBound]
        .trimmingCharacters(in: .whitespacesAndNewlines)
      return value == "production" ? "production" : "sandbox"
    }
    return "production"
    #endif
  }

  private init() {}

  private func state(perm: PushPerm? = nil) -> [String: Any] {
    let perm = perm ?? self.perm ?? .notDetermined
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
    let diag = diag()
    if !diag.isEmpty {
      next["diag"] = diag
    }
    return next
  }

  func refresh(emit: Bool = false) async -> [String: Any] {
    self.emit = self.emit || emit
    if let task {
      return await task.value
    }

    let task = Task { @MainActor [self] in
      let perm = await permission()
      self.perm = perm
      register(perm: perm)
      await retryPendingToken()
      let next = state(perm: perm)
      let emit = self.emit
      self.emit = false
      self.task = nil
      return finish(next, emit: emit)
    }
    self.task = task
    return await task.value
  }

  func request() async -> [String: Any] {
    await requestAuth()
    return await refresh(emit: true)
  }

  func notify(title: String?, body: String?, href: String?, kind: String?, generic: Bool, force: Bool = false) async -> Bool {
    if perm == nil {
      _ = await refresh()
    }
    let next = state()
    guard (next["allowed"] as? Bool) == true else { return false }
    if !force, UIApplication.shared.applicationState == .active { return false }
    if !force, paired() { return false }

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
    note(nil, code: nil)
    Task { @MainActor in
      if paired() {
        do {
          try await putToken(text)
          keychain.remove(tokenPendingKey)
        } catch {
          if !isRepair(error) {
            _ = keychain.set(Data("1".utf8), key: tokenPendingKey)
          }
        }
      }
      _ = await refresh(emit: true)
    }
  }

  func tokenDidFail() {
    keychain.remove(tokenKey)
    didRegister = false
    registerAt = .distantPast
    note("APNs registration failed", code: "apns_register_failed")
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
    keychain.remove(tokenPendingKey)
    note(nil, code: nil)
    return await refresh(emit: true)
  }

  func clearPairing() async throws -> [String: Any] {
    if paired() {
      do {
        try await deleteDevice()
      } catch {
        if !isRepair(error) {
          throw error
        }
      }
    }
    clearCredentials()
    clearPendingPair()
    keychain.remove(tokenPendingKey)
    lastCode = nil
    lastErr = nil
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
    let prev = relay()
    config.setPushRelayUrl(url)
    if relay() == prev { return }
    clearCredentials()
    clearPendingPair()
    keychain.remove(tokenPendingKey)
    lastCode = nil
    lastErr = nil
    _ = finish(state(), emit: true)
  }

  func beginPair(version: String?) async throws -> [String: Any] {
    guard let token = token(), !token.isEmpty else {
      note(PushErr.missingToken.localizedDescription, code: PushErr.missingToken.code)
      throw PushErr.missingToken
    }

    let req = PairStartReq(
      apns_token: token,
      device_name: UIDevice.current.model,
      app_version: version ?? "unknown",
      apns_env: PushBridge.apnsEnv
    )
    let res: PairStartRes = try await send(path: "/v1/pair/start", method: "POST", body: req)
    save(res.pair_id, key: pairIDKey)
    if let token = res.pair_token, !token.isEmpty {
      save(token, key: pairTokKey)
    } else {
      keychain.remove(pairTokKey)
    }
    save(res.install_command, key: pairCmdKey)
    save(res.expires_at, key: pairExpKey)
    pollTask?.cancel()
    pollTask = nil
    pollAt = .distantPast
    pollLast = nil
    return pair(
      id: res.pair_id,
      status: "pending",
      token: res.pair_token,
      command: res.install_command,
      expires: res.expires_at,
      channel: nil,
      device: nil,
      message: nil
    )
  }

  func getPair() async throws -> [String: Any]? {
    if paired() {
      let chan = channel()
      let dev = device()
      if text(pairIDKey) != nil {
        clearPendingPair()
      }
      return pair(
        id: nil,
        status: "active",
        token: nil,
        command: nil,
        expires: nil,
        channel: chan,
        device: dev,
        message: nil
      )
    }

    if let id = text(pairIDKey), !id.isEmpty {
      if let task = pollTask {
        return try await task.value
      }
      let age = Date().timeIntervalSince(pollAt)
      if age < pollGap, let last = pollLast {
        return last
      }

      let token = text(pairTokKey)
      let command = text(pairCmdKey)
      let expires = text(pairExpKey)
      let task = Task<[String: Any]?, Error> { @MainActor [self] in
        let mark = Int(Date().timeIntervalSince1970 * 1000)
        let path = "/v1/pair/\(id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id)?t=\(mark)"
        let res: PairPollRes = try await send(path: path, method: "GET")

        let next: [String: Any]?
        switch res.status {
        case "active":
          guard let channel = res.channel_id,
                let device = res.device_id,
                let secret = res.device_secret else {
            throw PushErr.badPair
          }
          _ = await setCredentials(channel: channel, device: device, secret: secret)
          clearPendingPair()
          next = pair(
            id: id,
            status: "active",
            token: nil,
            command: nil,
            expires: nil,
            channel: channel,
            device: device,
            message: nil
          )
        case "expired", "failed":
          clearPendingPair()
          next = pair(
            id: id,
            status: res.status,
            token: token,
            command: command,
            expires: expires,
            channel: nil,
            device: nil,
            message: res.message
          )
        default:
          next = pair(
            id: id,
            status: res.status,
            token: token,
            command: command,
            expires: expires,
            channel: nil,
            device: nil,
            message: res.message
          )
        }
        pollAt = Date()
        pollLast = next
        return next
      }
      pollTask = task
      defer {
        pollTask = nil
      }
      do {
        return try await task.value
      } catch {
        pollAt = Date()
        throw error
      }
    }

    pollLast = nil
    return nil
  }

  private func requestAuth() async {
    await withCheckedContinuation { cont in
      center.requestAuthorization(options: [.alert, .badge, .sound]) { _, _ in
        cont.resume()
      }
    }
    let perm = await permission()
    self.perm = perm
    register(force: true, perm: perm)
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

  private func register(force: Bool = false, perm: PushPerm? = nil) {
    let perm = perm ?? self.perm
    guard perm?.allowed == true else { return }
    let now = Date()
    if didRegister && !force {
      if token() != nil { return }
      if now.timeIntervalSince(registerAt) < registerGap { return }
    }
    didRegister = true
    registerAt = now
    UIApplication.shared.registerForRemoteNotifications()
  }

  private func retryPendingToken() async {
    guard keychain.get(tokenPendingKey) != nil else { return }
    guard paired(), let tok = token(), !tok.isEmpty else { return }
    do {
      try await putToken(tok)
      keychain.remove(tokenPendingKey)
    } catch {}
  }

  private func finish(_ next: [String: Any], emit: Bool) -> [String: Any] {
    let diag = next["diag"] as? [String: Any]
    let stamp = [
      next["permission"] as? String ?? "",
      (next["registered"] as? Bool) == true ? "registered" : "unregistered",
      (next["paired"] as? Bool) == true ? "paired" : "unpaired",
      next["channel"] as? String ?? "",
      diag?["device"] as? String ?? "",
      (diag?["tokenPending"] as? Bool) == true ? "token-pending" : "token-clear",
      diag?["pairStatus"] as? String ?? "",
      diag?["lastCode"] as? String ?? "",
      diag?["lastError"] as? String ?? "",
    ].joined(separator: ":")
    let changed = stamp != last
    last = stamp
    if emit, changed {
      onEvent?("pushStateChanged", next)
    }
    return next
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

  private func diag() -> [String: Any] {
    var next: [String: Any] = [
      "token": token() != nil,
      "relay": relay(),
    ]
    if let device = device(), !device.isEmpty {
      next["device"] = device
    }
    if paired() {
      next["pairStatus"] = "active"
    } else if let id = text(pairIDKey), !id.isEmpty {
      next["pairID"] = id
      next["pairStatus"] = "pending"
      if let expires = text(pairExpKey), !expires.isEmpty {
        next["pairExpires"] = expires
      }
    }
    if keychain.get(tokenPendingKey) != nil {
      next["tokenPending"] = true
    }
    if let lastCode, !lastCode.isEmpty {
      next["lastCode"] = lastCode
    }
    if let lastErr, !lastErr.isEmpty {
      next["lastError"] = lastErr
    }
    return next
  }

  private func note(_ value: String?, code: String?) {
    let next = value?.trimmingCharacters(in: .whitespacesAndNewlines)
    let text = next?.isEmpty == false ? next : nil
    let nextCode = code?.trimmingCharacters(in: .whitespacesAndNewlines)
    let valueCode = nextCode?.isEmpty == false ? nextCode : nil
    guard lastErr != text || lastCode != valueCode else { return }
    emitState(code: valueCode, message: text)
  }

  private func emitState(code: String?, message: String?) {
    let next = message?.trimmingCharacters(in: .whitespacesAndNewlines)
    let nextCode = code?.trimmingCharacters(in: .whitespacesAndNewlines)
    lastCode = nextCode?.isEmpty == false ? nextCode : nil
    lastErr = next?.isEmpty == false ? next : nil
    _ = finish(state(), emit: true)
  }

  private func recover(_ error: Error, path: String) -> Error? {
    guard path.hasPrefix("/v1/device"), let code = staleCode(error) else { return nil }
    clearCredentials()
    clearPendingPair()
    keychain.remove(tokenPendingKey)
    emitState(code: code, message: PushErr.repair.localizedDescription)
    return PushErr.repair
  }

  private func staleCode(_ error: Error) -> String? {
    guard let error = error as? PushErr else { return nil }
    switch error {
    case .relay(let message) where message == "device_not_found" || message == "bad_device_secret":
      return message
    default:
      return nil
    }
  }

  private func isRepair(_ error: Error) -> Bool {
    guard let error = error as? PushErr else { return false }
    if case .repair = error {
      return true
    }
    return false
  }

  private func normalize(_ error: Error) -> Error {
    guard let err = error as? URLError, err.code == .timedOut else {
      return error
    }
    return PushErr.relay(
      "Push relay request timed out. Check that the relay is reachable and try again."
    )
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
    pollTask?.cancel()
    pollTask = nil
    pollAt = .distantPast
    pollLast = nil
    keychain.remove(pairIDKey)
    keychain.remove(pairTokKey)
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
    token: String?,
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
    if let token, !token.isEmpty {
      next["token"] = token
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
      apns_token: token,
      apns_env: PushBridge.apnsEnv
    )
    let _: DeviceTokenRes = try await send(path: "/v1/device/token", method: "PUT", body: body)
  }

  private func deleteDevice() async throws {
    let _: DeviceDeleteRes = try await send(path: "/v1/device", method: "DELETE", body: auth())
  }

  private func request<T: Decodable>(path: String, method: String) async throws -> T {
    let root = relay()
    guard let base = URL(string: root), let url = URL(string: path, relativeTo: base) else {
      note(PushErr.badRelay.localizedDescription, code: PushErr.badRelay.code)
      throw PushErr.badRelay
    }

    var req = URLRequest(url: url)
    req.httpMethod = method
    req.setValue("application/json", forHTTPHeaderField: "Accept")
    req.setValue("no-cache", forHTTPHeaderField: "Cache-Control")
    req.cachePolicy = .reloadIgnoringLocalCacheData
    req.timeoutInterval = PushBridge.reqTimeout

    do {
      let (data, response) = try await session.data(for: req)
      let result: T = try parse(data: data, response: response)
      note(nil, code: nil)
      return result
    } catch {
      let err = normalize(error)
      if let recovered = recover(err, path: path) {
        throw recovered
      }
      note((err as? LocalizedError)?.errorDescription ?? err.localizedDescription, code: (err as? PushErr)?.code)
      throw err
    }
  }

  private func request<T: Decodable, Body: Encodable>(path: String, method: String, body: Body) async throws -> T {
    let root = relay()
    guard let base = URL(string: root), let url = URL(string: path, relativeTo: base) else {
      note(PushErr.badRelay.localizedDescription, code: PushErr.badRelay.code)
      throw PushErr.badRelay
    }

    var req = URLRequest(url: url)
    req.httpMethod = method
    req.setValue("application/json", forHTTPHeaderField: "Accept")
    req.httpBody = try JSONEncoder().encode(body)
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    req.setValue("no-cache", forHTTPHeaderField: "Cache-Control")
    req.cachePolicy = .reloadIgnoringLocalCacheData
    req.timeoutInterval = PushBridge.reqTimeout

    do {
      let (data, response) = try await session.data(for: req)
      let result: T = try parse(data: data, response: response)
      note(nil, code: nil)
      return result
    } catch {
      let err = normalize(error)
      if let recovered = recover(err, path: path) {
        throw recovered
      }
      note((err as? LocalizedError)?.errorDescription ?? err.localizedDescription, code: (err as? PushErr)?.code)
      throw err
    }
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
      (Bundle.main.object(forInfoDictionaryKey: "WhisperCodePushRelayURL") as? String ?? "https://whisper.clankercontext.com")
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
  let apns_env: String
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
  let apns_env: String
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
  case repair
  case relay(String)

  var code: String {
    switch self {
    case .missingToken:
      return "missing_token"
    case .badRelay:
      return "bad_relay"
    case .badReply:
      return "bad_reply"
    case .badPair:
      return "bad_pair"
    case .decode:
      return "decode"
    case .repair:
      return "repair_needed"
    case .relay(let message):
      if message == "device_not_found" || message == "bad_device_secret" {
        return "repair_needed"
      }
      if message == "rate_limited" || message.lowercased().contains("rate limited") {
        return "relay_rate_limited"
      }
      if message.lowercased().contains("timed out") {
        return "relay_timeout"
      }
      return "relay_error"
    }
  }

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
    case .repair:
      return "Push pairing is no longer valid on this relay. Re-pair this iPhone."
    case .relay(let message):
      if message == "rate_limited" || message.lowercased().contains("rate limited") {
        return "Push relay is temporarily rate limited. Wait a minute and try again."
      }
      return message
    }
  }
}
