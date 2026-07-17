package com.cumulusvpn.tunnel

import android.app.Activity
import android.content.Intent
import android.net.VpnService
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.BaseActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule

/**
 * React Native <-> Android bridge for the WireGuard tunnel.
 *
 * The data plane runs in the official wireguard-android [GoBackend] driven by
 * [CumulusTunnelController]; this module just parses/forwards configs and
 * streams status events back to JS. Method names + promise/event shapes match
 * `src/native/CumulusTunnel.ts`.
 *
 * PLAY COMPLIANCE (docs/05): shipping a VPN requires the Play Console
 * "VpnService" declaration form. Premium upgrade is manage-on-web, so no Play
 * Billing integration is needed at launch.
 */
class CumulusTunnelModule(
    private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {

    private var permissionPromise: Promise? = null

    private val activityListener: ActivityEventListener =
        object : BaseActivityEventListener() {
            override fun onActivityResult(
                activity: Activity,
                requestCode: Int,
                resultCode: Int,
                data: Intent?,
            ) {
                if (requestCode == VPN_PERMISSION_REQUEST) {
                    permissionPromise?.resolve(resultCode == Activity.RESULT_OK)
                    permissionPromise = null
                }
            }
        }

    init {
        reactContext.addActivityEventListener(activityListener)
        // Bridge controller state changes onto the JS event stream.
        CumulusTunnelController.setStateListener { state -> emitStatus(state) }
    }

    override fun getName(): String = "CumulusTunnel"

    /** startTunnel(wgConfig, serverName): Promise<void> */
    @ReactMethod
    fun startTunnel(wgConfig: String, serverName: String, promise: Promise) {
        try {
            CumulusTunnelController.startTunnel(reactContext, wgConfig)
            promise.resolve(null)
        } catch (t: Throwable) {
            promise.reject("E_START", t.message, t)
        }
    }

    /** startMultihop(outerConfig, innerConfig, routeLabel): Promise<void> */
    @ReactMethod
    fun startMultihop(outerConfig: String, innerConfig: String, routeLabel: String, promise: Promise) {
        try {
            CumulusTunnelController.startMultihop(reactContext, outerConfig, innerConfig)
            promise.resolve(null)
        } catch (t: Throwable) {
            promise.reject("E_START_MULTIHOP", t.message, t)
        }
    }

    /** stopTunnel(): Promise<void> */
    @ReactMethod
    fun stopTunnel(promise: Promise) {
        try {
            CumulusTunnelController.stopTunnel(reactContext)
            promise.resolve(null)
        } catch (t: Throwable) {
            promise.reject("E_STOP", t.message, t)
        }
    }

    /** getStatus(): Promise<TunnelStatus> */
    @ReactMethod
    fun getStatus(promise: Promise) {
        val stats = CumulusTunnelController.statistics(reactContext)
        promise.resolve(
            statusPayload(
                state = CumulusTunnelController.currentState(),
                rxBytes = stats.rxBytes.toDouble(),
                txBytes = stats.txBytes.toDouble(),
                lastHandshake = stats.lastHandshake.toDouble(),
            ),
        )
    }

    /** isPrepared(): Promise<boolean> — VpnService.prepare()==null means granted. */
    @ReactMethod
    fun isPrepared(promise: Promise) {
        promise.resolve(VpnService.prepare(reactContext) == null)
    }

    /**
     * requestPermission(): Promise<boolean>
     * Launches the system VPN consent dialog from the current Activity and
     * resolves once the user answers (via [activityListener]).
     */
    @ReactMethod
    fun requestPermission(promise: Promise) {
        val consent = VpnService.prepare(reactContext)
        if (consent == null) {
            promise.resolve(true) // already granted
            return
        }
        val activity = reactContext.currentActivity
        if (activity == null) {
            promise.reject("E_NO_ACTIVITY", "No foreground activity to request VPN consent")
            return
        }
        permissionPromise = promise
        activity.startActivityForResult(consent, VPN_PERMISSION_REQUEST)
    }

    // Required for RN's NativeEventEmitter (JS-side addListener/removeListeners).
    @ReactMethod
    fun addListener(eventName: String) {
        // no-op; DeviceEventManagerModule handles delivery.
    }

    @ReactMethod
    fun removeListeners(count: Int) {
        // no-op.
    }

    /** Emit a status sample to JS. Bytes/handshake are polled separately via getStatus. */
    private fun emitStatus(state: String) {
        val stats = CumulusTunnelController.statistics(reactContext)
        val payload =
            statusPayload(
                state = state,
                rxBytes = stats.rxBytes.toDouble(),
                txBytes = stats.txBytes.toDouble(),
                lastHandshake = stats.lastHandshake.toDouble(),
            )
        reactContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit("CumulusTunnelStatus", payload)
    }

    private fun statusPayload(
        state: String,
        rxBytes: Double,
        txBytes: Double,
        lastHandshake: Double,
    ): WritableMap =
        Arguments.createMap().apply {
            putString("state", state)
            putDouble("rxBytes", rxBytes)
            putDouble("txBytes", txBytes)
            putDouble("lastHandshake", lastHandshake)
        }

    companion object {
        private const val VPN_PERMISSION_REQUEST = 0x7601
    }
}
