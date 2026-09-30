package com.cumulusvpn.identity

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.google.android.gms.auth.blockstore.Blockstore
import com.google.android.gms.auth.blockstore.DeleteBytesRequest
import com.google.android.gms.auth.blockstore.RetrieveBytesRequest
import com.google.android.gms.auth.blockstore.StoreBytesData
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability

/**
 * Keeps a copy of the device identity in Google's Block Store, so deleting and
 * reinstalling the app — or setting up a new phone — brings the same identity
 * (and the premium paid for it) back.
 *
 * Block Store lives in Google Play services, outside the app's own data, which
 * `android:allowBackup="false"` otherwise wipes on uninstall. The copy is kept
 * on the device across reinstalls whenever Google backup is on, and moves to a
 * new phone in device-to-device setup. It goes to Google's cloud ONLY when that
 * cloud copy is end-to-end encrypted with the screen lock — without a screen
 * lock Google could read it, and a VPN identity is not something we hand over.
 *
 * What is stored is the recovery-key string (checksummed), never interpreted
 * here. Method names + promise shapes match `src/native/CumulusIdentity.ts`.
 * Without Play services (some direct-APK installs) every call reports
 * "unavailable" and the in-app recovery key is the only backup.
 */
class CumulusIdentityModule(
    reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {
    private val client by lazy { Blockstore.getClient(reactApplicationContext) }

    override fun getName(): String = "CumulusIdentity"

    private fun playServicesReady(): Boolean =
        GoogleApiAvailability.getInstance()
            .isGooglePlayServicesAvailable(reactApplicationContext) == ConnectionResult.SUCCESS

    /** Store [secret]; resolves "cloud", "device" or "unavailable". */
    @ReactMethod
    fun save(secret: String, promise: Promise) {
        if (!playServicesReady()) {
            promise.resolve(UNAVAILABLE)
            return
        }
        client.isEndToEndEncryptionAvailable()
            .addOnSuccessListener { e2ee ->
                val cloud = e2ee == true
                val data = StoreBytesData.Builder()
                    .setKey(KEY)
                    .setBytes(secret.toByteArray(Charsets.UTF_8))
                    // false also deletes a cloud copy made earlier, on the next sync.
                    .setShouldBackupToCloud(cloud)
                    .build()
                client.storeBytes(data)
                    .addOnSuccessListener { promise.resolve(if (cloud) "cloud" else "device") }
                    .addOnFailureListener { e -> promise.reject("E_BACKUP", e.message, e) }
            }
            .addOnFailureListener { e -> promise.reject("E_BACKUP", e.message, e) }
    }

    /**
     * Read the stored secret. Resolves `{status:"ok", value}` (value null when
     * nothing is stored) or `{status:"unavailable"}`; REJECTS when Block Store
     * could not answer, so the caller can tell "empty" from "unknown" and never
     * overwrites a backup it failed to read.
     */
    @ReactMethod
    fun load(promise: Promise) {
        val out = Arguments.createMap()
        if (!playServicesReady()) {
            out.putString("status", UNAVAILABLE)
            promise.resolve(out)
            return
        }
        val request = RetrieveBytesRequest.Builder().setKeys(listOf(KEY)).build()
        client.retrieveBytes(request)
            .addOnSuccessListener { response ->
                val bytes = response.blockstoreDataMap[KEY]?.bytes
                out.putString("status", "ok")
                if (bytes == null || bytes.isEmpty()) {
                    out.putNull("value")
                } else {
                    out.putString("value", String(bytes, Charsets.UTF_8))
                }
                promise.resolve(out)
            }
            .addOnFailureListener { e -> promise.reject("E_BACKUP", e.message, e) }
    }

    /** Delete the stored secret, here and (on its next sync) in the cloud. */
    @ReactMethod
    fun remove(promise: Promise) {
        if (!playServicesReady()) {
            promise.resolve(false)
            return
        }
        val request = DeleteBytesRequest.Builder().setKeys(listOf(KEY)).build()
        client.deleteBytes(request)
            .addOnSuccessListener { deleted -> promise.resolve(deleted == true) }
            .addOnFailureListener { e -> promise.reject("E_BACKUP", e.message, e) }
    }

    private companion object {
        const val KEY = "com.cumulusvpn.identity.v1"
        const val UNAVAILABLE = "unavailable"
    }
}
