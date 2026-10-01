import UIKit
import React
import React_RCTAppDelegate

// Apps built with the iOS 27 SDK must adopt the scene life cycle, or UIKit stops
// them at launch (_UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption).
// The window lives here; AppDelegate still builds the React Native factory.
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard
      let windowScene = scene as? UIWindowScene,
      let appDelegate = UIApplication.shared.delegate as? AppDelegate,
      let factory = appDelegate.reactNativeFactory
    else { return }

    let window = UIWindow(windowScene: windowScene)
    self.window = window
    // React Native helpers still look the window up on the app delegate.
    appDelegate.window = window

    factory.startReactNative(
      withModuleName: "CumulusVPN",
      in: window,
      launchOptions: appDelegate.launchOptions
    )
  }
}
