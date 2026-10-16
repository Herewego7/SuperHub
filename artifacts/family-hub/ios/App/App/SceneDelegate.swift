import UIKit
import Capacitor

/// The app's window lives in a scene. iOS 27 no longer launches a UIKit app
/// that only has an app delegate (Apple's scene-based life cycle requirement,
/// announced with iOS 26), so SuperHub crashed on open after the update.
///
/// The window and ViewController still come from Main.storyboard, named in
/// Info.plist's UIApplicationSceneManifest. Links that open the app
/// (superhub://, universal links) now arrive here instead of the app
/// delegate, so they are handed to Capacitor's scene proxy, which passes them
/// on to the App plugin the same way the app delegate used to.
class SceneDelegate: UIResponder, UIWindowSceneDelegate {

    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
