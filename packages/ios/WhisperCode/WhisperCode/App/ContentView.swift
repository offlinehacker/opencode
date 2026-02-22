import SwiftUI

struct ContentView: View {
  var body: some View {
    OpenCodeWebView()
      .ignoresSafeArea(.all, edges: .bottom)
  }
}
