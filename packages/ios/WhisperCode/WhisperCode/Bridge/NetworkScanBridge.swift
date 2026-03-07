import Foundation
import Network

final class NetworkScanBridge: @unchecked Sendable {
  var onFound: (([String: Any]) -> Void)?
  var onComplete: (() -> Void)?

  private let queue = DispatchQueue(label: "ai.opencode.network-scan", attributes: .concurrent)
  private let lock = DispatchQueue(label: "ai.opencode.network-scan.lock")
  private var cancelled = false
  private var generation = 0

  func scan() {
    let gen: Int = lock.sync {
      cancelled = false
      generation += 1
      return generation
    }

    queue.async { [weak self] in
      guard let self else { return }
      guard let (ip, mask) = self.wifiAddress() else {
        DispatchQueue.main.async { self.fireComplete(gen: gen) }
        return
      }

      let hosts = self.subnetHosts(ip: ip, mask: mask)
      let batchSize = 50
      let semaphore = DispatchSemaphore(value: batchSize)
      let group = DispatchGroup()

      for host in hosts {
        let stop = self.lock.sync { self.cancelled || self.generation != gen }
        if stop { break }
        semaphore.wait()
        group.enter()
        self.probe(host: host, gen: gen) {
          semaphore.signal()
          group.leave()
        }
      }

      group.notify(queue: .main) {
        self.fireComplete(gen: gen)
      }
    }
  }

  func cancel() {
    lock.sync { cancelled = true }
  }

  private func isStale(gen: Int) -> Bool {
    lock.sync { cancelled || generation != gen }
  }

  private func fireFound(gen: Int, result: [String: Any]) {
    guard !isStale(gen: gen) else { return }
    onFound?(result)
  }

  private func fireComplete(gen: Int) {
    guard !isStale(gen: gen) else { return }
    onComplete?()
  }

  private func probe(host: String, gen: Int, done: @escaping () -> Void) {
    let port: UInt16 = 4096
    let endpoint = NWEndpoint.hostPort(host: NWEndpoint.Host(host), port: NWEndpoint.Port(rawValue: port)!)
    let connection = NWConnection(to: endpoint, using: .tcp)

    let completed = LockedFlag()
    let finish = { [weak self] (found: Bool) in
      guard completed.setIfFalse() else { return }
      connection.cancel()
      if found {
        self?.verifyHealth(host: host, port: port, gen: gen, done: done)
      } else {
        done()
      }
    }

    let timeout = DispatchWorkItem { finish(false) }
    queue.asyncAfter(deadline: .now() + .milliseconds(500), execute: timeout)

    connection.stateUpdateHandler = { state in
      switch state {
      case .ready:
        timeout.cancel()
        finish(true)
      case .failed, .cancelled:
        timeout.cancel()
        finish(false)
      default:
        break
      }
    }

    connection.start(queue: queue)
  }

  private func verifyHealth(host: String, port: UInt16, gen: Int, done: @escaping () -> Void) {
    let urlString = "http://\(host):\(port)"
    guard let url = URL(string: "\(urlString)/global/health") else {
      done()
      return
    }

    var request = URLRequest(url: url)
    request.timeoutInterval = 3
    request.httpMethod = "GET"

    URLSession.shared.dataTask(with: request) { [weak self] _, response, _ in
      guard let self, !self.isStale(gen: gen) else {
        done()
        return
      }
      let http = response as? HTTPURLResponse
      if http?.statusCode == 200 {
        DispatchQueue.main.async {
          self.fireFound(gen: gen, result: [
            "host": host,
            "port": port,
            "url": urlString,
          ])
        }
      }
      done()
    }.resume()
  }

  private func wifiAddress() -> (String, String)? {
    var address: String?
    var mask: String?
    var ifaddr: UnsafeMutablePointer<ifaddrs>?
    guard getifaddrs(&ifaddr) == 0, let first = ifaddr else { return nil }
    defer { freeifaddrs(first) }

    for ptr in sequence(first: first, next: { $0.pointee.ifa_next }) {
      let iface = ptr.pointee
      guard let addrPtr = iface.ifa_addr else { continue }
      guard addrPtr.pointee.sa_family == UInt8(AF_INET) else { continue }
      let name = String(cString: iface.ifa_name)
      guard name == "en0" else { continue }

      var addr = addrPtr.pointee
      var hostname = [CChar](repeating: 0, count: Int(NI_MAXHOST))
      getnameinfo(&addr, socklen_t(addr.sa_len), &hostname, socklen_t(hostname.count), nil, 0, NI_NUMERICHOST)
      address = String(cString: hostname)

      if let maskAddr = iface.ifa_netmask {
        var maddr = maskAddr.pointee
        var maskBuf = [CChar](repeating: 0, count: Int(NI_MAXHOST))
        getnameinfo(&maddr, socklen_t(maddr.sa_len), &maskBuf, socklen_t(maskBuf.count), nil, 0, NI_NUMERICHOST)
        mask = String(cString: maskBuf)
      }

      break
    }

    guard let ip = address, let netmask = mask else { return nil }
    return (ip, netmask)
  }

  private func subnetHosts(ip: String, mask: String) -> [String] {
    let ipParts = ip.split(separator: ".").compactMap { UInt32($0) }
    let maskParts = mask.split(separator: ".").compactMap { UInt32($0) }
    guard ipParts.count == 4, maskParts.count == 4 else { return [] }

    let ipNum = (ipParts[0] << 24) | (ipParts[1] << 16) | (ipParts[2] << 8) | ipParts[3]
    let maskNum = (maskParts[0] << 24) | (maskParts[1] << 16) | (maskParts[2] << 8) | maskParts[3]
    let network = ipNum & maskNum
    let broadcast = network | ~maskNum

    var hosts = [String]()
    let start = network + 1
    let end = broadcast
    guard start < end else { return [] }

    for addr in start..<end {
      hosts.append("\(addr >> 24 & 0xFF).\(addr >> 16 & 0xFF).\(addr >> 8 & 0xFF).\(addr & 0xFF)")
    }
    return hosts
  }
}

/// Thread-safe one-shot flag. Returns `true` from `setIfFalse()` exactly once.
private final class LockedFlag: @unchecked Sendable {
  private let lock = DispatchQueue(label: "ai.opencode.locked-flag")
  private var value = false

  func setIfFalse() -> Bool {
    lock.sync {
      if value { return false }
      value = true
      return true
    }
  }
}
