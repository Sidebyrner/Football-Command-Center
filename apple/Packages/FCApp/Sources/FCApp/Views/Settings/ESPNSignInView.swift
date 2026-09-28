import SwiftUI
import WebKit
import FCData

/// ESPN's own sign-in page, in a throwaway web view.
///
/// The app never sees the password. ESPN sets two cookies when sign-in
/// succeeds; this view watches for them, hands them back, and is dismissed —
/// the web view's data store is non-persistent, so nothing from the page
/// outlives the sheet. Navigation is limited to ESPN's and Disney's sign-in
/// hosts, so the sheet cannot be steered anywhere else.
public struct ESPNSignInView: View {
    let onCredentials: (ESPNCredentials) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var isLoading = true

    public init(onCredentials: @escaping (ESPNCredentials) -> Void) {
        self.onCredentials = onCredentials
    }

    public var body: some View {
        NavigationStack {
            ZStack {
                ESPNSignInWebView(isLoading: $isLoading) { credentials in
                    onCredentials(credentials)
                    dismiss()
                }
                if isLoading {
                    ProgressView().controlSize(.large).allowsHitTesting(false)
                }
            }
            .navigationTitle("Sign in to ESPN")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
            .safeAreaInset(edge: .bottom) {
                Text("You sign in on ESPN's own page. The app keeps only the two session cookies ESPN issues, on this device, and sends them only to ESPN.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal)
                    .padding(.vertical, 8)
                    .frame(maxWidth: .infinity)
                    .background(.bar)
            }
        }
        #if os(macOS)
        .frame(minWidth: 520, minHeight: 640)
        #endif
    }
}

/// The `WKWebView` itself, shared between the iOS and macOS representables.
struct ESPNSignInWebView {
    @Binding var isLoading: Bool
    let onCredentials: (ESPNCredentials) -> Void

    static let loginURL = URL(string: "https://www.espn.com/login")!

    /// Hosts the sign-in flow legitimately touches: ESPN, Disney's account
    /// service (OneID lives under go.com), and their CDNs. Anything else is
    /// refused, whatever the page tries to open.
    static let allowedHostSuffixes = [
        "espn.com", "espncdn.com", "go.com", "disney.com", "disneyplus.com", "dssott.com",
    ]

    static func isAllowed(_ url: URL?) -> Bool {
        guard let url else { return false }
        if url.scheme == "about" { return true }
        guard url.scheme == "https", let host = url.host?.lowercased() else { return false }
        return allowedHostSuffixes.contains { host == $0 || host.hasSuffix("." + $0) }
    }

    func makeWebView(coordinator: Coordinator) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = coordinator
        webView.uiDelegate = coordinator
        coordinator.webView = webView
        webView.load(URLRequest(url: Self.loginURL))
        return webView
    }

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        private let parent: ESPNSignInWebView
        weak var webView: WKWebView?
        private var delivered = false

        init(_ parent: ESPNSignInWebView) { self.parent = parent }

        func webView(
            _ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            decisionHandler(ESPNSignInWebView.isAllowed(navigationAction.request.url) ? .allow : .cancel)
        }

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
            parent.isLoading = true
        }

        /// The page has started rendering; the sign-in form is inside an
        /// iframe that keeps loading after this, so waiting for `didFinish`
        /// leaves a spinner over a usable form.
        func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
            parent.isLoading = false
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            parent.isLoading = false
            checkForCredentials(in: webView)
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            parent.isLoading = false
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            parent.isLoading = false
        }

        /// Pop-ups are loaded in the same view when they are allowed, and
        /// dropped otherwise — never opened in a browser.
        func webView(
            _ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
            for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures
        ) -> WKWebView? {
            if navigationAction.targetFrame == nil, ESPNSignInWebView.isAllowed(navigationAction.request.url) {
                webView.load(navigationAction.request)
            }
            return nil
        }

        /// ESPN sets both cookies on `.espn.com` once the account is signed
        /// in. The sign-in happens inside an iframe, so the outer page may
        /// never navigate; hence polling after each load as well.
        private func checkForCredentials(in webView: WKWebView) {
            guard !delivered else { return }
            webView.configuration.websiteDataStore.httpCookieStore.getAllCookies { [weak self] cookies in
                guard let self, !self.delivered else { return }
                let espn = cookies.filter { $0.domain.lowercased().hasSuffix("espn.com") }
                guard let s2 = espn.first(where: { $0.name == "espn_s2" })?.value, !s2.isEmpty,
                      let swid = espn.first(where: { $0.name == "SWID" })?.value, !swid.isEmpty
                else {
                    self.scheduleRecheck()
                    return
                }
                self.delivered = true
                self.parent.onCredentials(ESPNCredentials(espnS2: s2, swid: swid))
            }
        }

        private func scheduleRecheck() {
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in
                guard let self, let webView = self.webView else { return }
                self.checkForCredentials(in: webView)
            }
        }
    }
}

#if os(iOS)
extension ESPNSignInWebView: UIViewRepresentable {
    func makeUIView(context: Context) -> WKWebView { makeWebView(coordinator: context.coordinator) }
    func updateUIView(_ uiView: WKWebView, context: Context) {}
}
#else
extension ESPNSignInWebView: NSViewRepresentable {
    func makeNSView(context: Context) -> WKWebView { makeWebView(coordinator: context.coordinator) }
    func updateNSView(_ nsView: WKWebView, context: Context) {}
}
#endif
