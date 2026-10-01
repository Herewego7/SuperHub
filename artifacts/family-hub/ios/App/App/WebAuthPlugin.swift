import Capacitor
import AuthenticationServices

/**
 * WebAuthPlugin — wraps ASWebAuthenticationSession for native OAuth on iOS.
 *
 * SFSafariViewController (used by @capacitor/browser) partitions sessionStorage
 * per navigation, which breaks Replit's OIDC "state" check mid-flow.
 * ASWebAuthenticationSession is Apple's purpose-built OAuth browser: it shares
 * a persistent cookie/storage jar across the entire auth exchange, handles the
 * familyhub:// callback scheme natively, and returns the redirect URL directly
 * to the completion handler without needing a separate appUrlOpen listener.
 */
@objc(WebAuthPlugin)
public class WebAuthPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "WebAuthPlugin"
    public let jsName = "WebAuth"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "authenticate", returnType: CAPPluginReturnPromise)
    ]

    // Hold a strong reference so the session isn't deallocated mid-flow.
    private var authSession: ASWebAuthenticationSession?

    @objc func authenticate(_ call: CAPPluginCall) {
        guard
            let urlString = call.getString("url"),
            let url = URL(string: urlString),
            let scheme = call.getString("callbackScheme")
        else {
            call.reject("Missing required options: url, callbackScheme")
            return
        }

        DispatchQueue.main.async { [weak self] in
            guard let self else { return }

            let session = ASWebAuthenticationSession(
                url: url,
                callbackURLScheme: scheme
            ) { [weak self] callbackURL, error in
                self?.authSession = nil

                if let error = error as NSError? {
                    if error.code == ASWebAuthenticationSessionError.canceledLogin.rawValue {
                        call.reject("USER_CANCELLED")
                    } else {
                        call.reject(error.localizedDescription)
                    }
                    return
                }

                guard let callbackURL else {
                    call.reject("No callback URL received")
                    return
                }

                call.resolve(["url": callbackURL.absoluteString])
            }

            session.presentationContextProvider = self
            // Default false = share Safari's persistent cookie jar. The server
            // explicitly saves mobileRedirect before the OIDC redirect, so the
            // shared session cookie is enough to retrieve it in /api/callback.
            // Using the shared jar avoids an iOS behavior where Set-Cookie
            // headers from 302 responses are dropped in ephemeral mode.
            //
            // Callers that don't need cookie sharing (e.g. calendar-connect
            // OAuth, which is a one-off token exchange, not an app session)
            // should pass ephemeral: true — besides being more private, it
            // also skips iOS's "'<App>' wants to use '<domain>' to sign in"
            // system dialog, which otherwise appears for any non-ephemeral
            // session regardless of what OAuth scopes are actually requested.
            session.prefersEphemeralWebBrowserSession = call.getBool("ephemeral", false)
            self.authSession = session
            session.start()
        }
    }
}

extension WebAuthPlugin: ASWebAuthenticationPresentationContextProviding {
    public func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        // Walk up from the Capacitor bridge view controller to find the key window.
        if let window = bridge?.viewController?.view.window {
            return window
        }
        // Fallback: first connected scene's key window.
        for scene in UIApplication.shared.connectedScenes {
            if let ws = scene as? UIWindowScene, let window = ws.keyWindow {
                return window
            }
        }
        return UIWindow()
    }
}
