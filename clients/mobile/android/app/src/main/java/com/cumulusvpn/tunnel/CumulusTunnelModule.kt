package com.cumulusvpn.tunnel

import android.app.Activity
import android.content.Intent
import android.net.VpnService
import android.provider.Settings
import java.security.MessageDigest
import java.util.concurrent.Executors
import kotlin.random.Random
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

    // A small pool so the two multi-hop enrollments can solve their PoW
    // concurrently on separate cores instead of serialising. Native SHA-256 is
    // ~100x the Hermes JS solver, so each 20-bit solve is well under a second.
    private val powExecutor = Executors.newCachedThreadPool()

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

    /**
     * startTunnel(wgConfig, serverName, killSwitch): Promise<void>
     *
     * `killSwitch` is accepted for cross-platform parity but is a native no-op on
     * Android: a true always-on kill switch is the OS "Block connections without
     * VPN" (lockdown) setting, which apps cannot toggle programmatically — the JS
     * layer routes the user to it via [openVpnSettings]. While our VpnService
     * holds the tun, traffic is already captured, so there is no in-session leak.
     */
    @ReactMethod
    fun startTunnel(wgConfig: String, serverName: String, killSwitch: Boolean, promise: Promise) {
        try {
            CumulusTunnelController.startTunnel(reactContext, wgConfig)
            promise.resolve(null)
        } catch (t: Throwable) {
            promise.reject("E_START", t.message, t)
        }
    }

    /** startMultihop(outerConfig, innerConfig, routeLabel, killSwitch): Promise<void> */
    @ReactMethod
    fun startMultihop(
        outerConfig: String,
        innerConfig: String,
        routeLabel: String,
        killSwitch: Boolean,
        promise: Promise,
    ) {
        try {
            CumulusTunnelController.startMultihop(reactContext, outerConfig, innerConfig)
            promise.resolve(null)
        } catch (t: Throwable) {
            promise.reject("E_START_MULTIHOP", t.message, t)
        }
    }

    /**
     * openVpnSettings(): Promise<void> — open the OS VPN settings so the user can
     * turn on "Always-on VPN" + "Block connections without VPN" (the Android
     * lockdown kill switch, which apps may not enable programmatically).
     */
    @ReactMethod
    fun openVpnSettings(promise: Promise) {
        try {
            val intent = Intent(Settings.ACTION_VPN_SETTINGS).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            reactContext.startActivity(intent)
            promise.resolve(null)
        } catch (t: Throwable) {
            promise.reject("E_SETTINGS", t.message, t)
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

    /**
     * solvePow(publicKeyB64, bits): Promise<String>
     *
     * Solve the enroll anti-flood proof-of-work natively: find a decimal-string
     * `nonce` such that `sha256(pubkey||nonce)` has `bits` leading zero bits.
     * Runs off the JS thread on [powExecutor]; native SHA-256 clears the 20-bit
     * difficulty in well under a second (the pure-JS Hermes solver takes many
     * seconds and freezes the UI). Mirrors core `solvePoW`/`hasLeadingZeroBits`.
     */
    @ReactMethod
    fun solvePow(publicKeyB64: String, bits: Double, promise: Promise) {
        powExecutor.execute {
            try {
                promise.resolve(solvePowSync(publicKeyB64, bits.toInt()))
            } catch (t: Throwable) {
                promise.reject("E_POW", t.message, t)
            }
        }
    }

    private fun solvePowSync(publicKeyB64: String, bits: Int): String {
        val md = MessageDigest.getInstance("SHA-256")
        val pub = publicKeyB64.toByteArray(Charsets.UTF_8)
        // Random start so repeated solves for the same key yield DIFFERENT valid
        // nonces — the gateway single-uses each (pubkey, nonce) pair, so a fixed
        // start would make a re-enroll look like a replay ("bad_pow").
        var i = Random.nextLong(0, 0x40000000L)
        while (true) {
            val nonce = i.toString()
            md.reset()
            md.update(pub)
            md.update(nonce.toByteArray(Charsets.UTF_8))
            if (hasLeadingZeroBits(md.digest(), bits)) {
                return nonce
            }
            i++
        }
    }

    /** True if `digest` starts with at least `bits` zero bits (mirrors core). */
    private fun hasLeadingZeroBits(digest: ByteArray, bits: Int): Boolean {
        val full = bits / 8
        for (k in 0 until full) {
            if (digest[k].toInt() != 0) {
                return false
            }
        }
        val rem = bits % 8
        if (rem != 0) {
            val mask = (0xff shl (8 - rem)) and 0xff
            if ((digest[full].toInt() and mask) != 0) {
                return false
            }
        }
        return true
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
