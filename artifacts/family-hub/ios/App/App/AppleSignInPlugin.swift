import Capacitor
import AuthenticationServices

/**
 * AppleSignInPlugin — wraps ASAuthorizationAppleIDProvider for native
 * "Sign in with Apple" on iOS.
 *
 * Custom (app-local) plugin instead of `@capacitor-community/apple-sign-in`:
 * that community plugin's Package.swift pins `capacitor-swift-pm` to the
 * `7.0.0..<8.0.0` range, which conflicts with every other plugin in this app
 * (all on `8.x`) and makes the whole Xcode project fail to resolve
 * ("Missing package product 'CapApp-SPM'"). This plugin needs only the iOS
 * native API directly — no third-party manifest to go stale, no dependency
 * to re-check on every future Capacitor major version.
 *
 * The result handed back to JS is intentionally raw (identityToken +
 * whatever name/email Apple included) — verification and user creation
 * happen server-side in `POST /api/auth/apple` (appleAuth.ts), never here.
 */
@objc(AppleSignInPlugin)
public class AppleSignInPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AppleSignInPlugin"
    public let jsName = "AppleSignIn"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "authorize", returnType: CAPPluginReturnPromise)
    ]

    // Held strongly so neither is deallocated mid-flow (delegate callbacks
    // fire asynchronously, off this method's own call stack).
    private var pendingCall: CAPPluginCall?
    private var controller: ASAuthorizationController?

    @objc func authorize(_ call: CAPPluginCall) {
        pendingCall = call

        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            let provider = ASAuthorizationAppleIDProvider()
            let request = provider.createRequest()
            request.requestedScopes = [.fullName, .email]

            let controller = ASAuthorizationController(authorizationRequests: [request])
            controller.delegate = self
            controller.presentationContextProvider = self
            self.controller = controller
            controller.performRequests()
        }
    }
}

extension AppleSignInPlugin: ASAuthorizationControllerDelegate {
    public func authorizationController(
        controller: ASAuthorizationController,
        didCompleteWithAuthorization authorization: ASAuthorization
    ) {
        let call = pendingCall
        pendingCall = nil
        self.controller = nil
        guard let call else { return }

        guard
            let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
            let tokenData = credential.identityToken,
            let identityToken = String(data: tokenData, encoding: .utf8)
        else {
            call.reject("No identity token received from Apple")
            return
        }

        var result: [String: Any] = [
            "identityToken": identityToken,
            "userIdentifier": credential.user
        ]
        // Apple only includes the name/email on the FIRST authorization for a
        // given Apple ID + this app — later sign-ins omit both, so the server
        // must persist whatever it gets on that first call (it already does;
        // see appleAuth.ts / localAuthRoutes.ts). Omitted here (not sent as
        // empty strings) so the server can tell "not provided" apart from
        // "provided but blank".
        if let given = credential.fullName?.givenName, !given.isEmpty {
            result["firstName"] = given
        }
        if let family = credential.fullName?.familyName, !family.isEmpty {
            result["lastName"] = family
        }
        if let email = credential.email, !email.isEmpty {
            result["email"] = email
        }
        call.resolve(result)
    }

    public func authorizationController(
        controller: ASAuthorizationController,
        didCompleteWithError error: Error
    ) {
        let call = pendingCall
        pendingCall = nil
        self.controller = nil
        guard let call else { return }

        if let authError = error as? ASAuthorizationError, authError.code == .canceled {
            call.reject("USER_CANCELLED")
        } else {
            call.reject(error.localizedDescription)
        }
    }
}

extension AppleSignInPlugin: ASAuthorizationControllerPresentationContextProviding {
    public func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        // Same fallback chain as WebAuthPlugin: walk up from the Capacitor
        // bridge's view controller to find the key window.
        if let window = bridge?.viewController?.view.window {
            return window
        }
        for scene in UIApplication.shared.connectedScenes {
            if let ws = scene as? UIWindowScene, let window = ws.keyWindow {
                return window
            }
        }
        return UIWindow()
    }
}
