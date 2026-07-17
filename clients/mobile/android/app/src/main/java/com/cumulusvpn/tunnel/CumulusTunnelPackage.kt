package com.cumulusvpn.tunnel

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

/**
 * Registers [CumulusTunnelModule] with React Native.
 * Add to `getPackages()` in MainApplication (or rely on autolinking once this
 * is extracted into its own RN library package).
 */
class CumulusTunnelPackage : ReactPackage {
    override fun createNativeModules(
        reactContext: ReactApplicationContext,
    ): List<NativeModule> = listOf(CumulusTunnelModule(reactContext))

    override fun createViewManagers(
        reactContext: ReactApplicationContext,
    ): List<ViewManager<*, *>> = emptyList()
}
