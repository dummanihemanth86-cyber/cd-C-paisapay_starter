package com.paisapay.app

import android.app.DownloadManager
import android.content.BroadcastReceiver
import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.Settings
import android.util.Base64
import androidx.core.content.FileProvider
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.uimanager.ViewManager
import java.io.File
import java.security.MessageDigest

class PaisaPayUpdaterPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
    listOf(PaisaPayUpdaterModule(reactContext))

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}

private class UpdateVerificationException(val errorCode: String, message: String) : IllegalStateException(message)

class PaisaPayUpdaterModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  companion object { const val NAME = "PaisaPayUpdater" }

  private var activeDownloadId: Long? = null
  private var activePromise: Promise? = null
  private var downloadReceiver: BroadcastReceiver? = null

  override fun getName() = NAME

  @ReactMethod
  fun getInstalledVersion(promise: Promise) {
    try {
      val info = context.packageManager.getPackageInfo(context.packageName, 0)
      val buildCode = versionCode(info)
      val result = com.facebook.react.bridge.Arguments.createMap().apply {
        putString("version", info.versionName ?: "")
        putDouble("buildCode", buildCode.toDouble())
      }
      promise.resolve(result)
    } catch (_: Exception) {
      promise.reject("APP_UPDATE_VERSION_READ_FAILED", "Installed app version could not be read.")
    }
  }

  @ReactMethod
  fun downloadAndInstall(apkUrl: String, expectedVersion: String, expectedBuildCode: Double, expectedSha256: String, promise: Promise) {
    val parsed = try { Uri.parse(apkUrl) } catch (_: Exception) { null }
    val buildCode = expectedBuildCode.toLong()
    if (parsed?.scheme != "https" || parsed.host.isNullOrBlank() || parsed.userInfo != null ||
      !expectedVersion.matches(Regex("\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?")) ||
      buildCode <= 0 || buildCode.toDouble() != expectedBuildCode || !expectedSha256.matches(Regex("[a-fA-F0-9]{64}"))) {
      promise.reject("APP_UPDATE_METADATA_INVALID", "The update information is invalid. No file was downloaded.")
      return
    }

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !context.packageManager.canRequestPackageInstalls()) {
      try {
        val activity = context.currentActivity ?: throw IllegalStateException("No active app screen.")
        activity.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}")))
        promise.resolve("permission_required")
      } catch (_: Exception) {
        promise.reject("APP_UPDATE_PERMISSION_REQUIRED", "Allow PaisaPay to install updates in Android settings, then try again.")
      }
      return
    }

    if (activePromise != null) {
      promise.reject("APP_UPDATE_ALREADY_RUNNING", "An app update is already downloading.")
      return
    }

    try {
      val manager = context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
      val fileName = "paisapay-update-${expectedSha256.lowercase().take(16)}.apk"
      val downloadDirectory = context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS)
        ?: throw IllegalStateException("Update storage unavailable.")
      File(downloadDirectory, fileName).delete()
      val request = DownloadManager.Request(parsed)
        .setTitle("PaisaPay update")
        .setDescription("Downloading the verified PaisaPay app update")
        .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
        .setAllowedOverMetered(true)
        .setAllowedOverRoaming(false)
        .setDestinationInExternalFilesDir(context, Environment.DIRECTORY_DOWNLOADS, fileName)

      activePromise = promise
      pendingExpectedSha256 = expectedSha256
      pendingExpectedVersion = expectedVersion
      pendingExpectedBuildCode = buildCode
      registerCompletionReceiver(manager)
      activeDownloadId = manager.enqueue(request)
    } catch (_: Exception) {
      finishWithError("APP_UPDATE_DOWNLOAD_START_FAILED", "The app update download could not be started.")
    }
  }

  private fun registerCompletionReceiver(manager: DownloadManager) {
    unregisterCompletionReceiver()
    val receiver = object : BroadcastReceiver() {
      override fun onReceive(receiverContext: Context?, intent: Intent?) {
        val completedId = intent?.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1L) ?: -1L
        if (completedId != activeDownloadId) return
        try {
          val query = manager.query(DownloadManager.Query().setFilterById(completedId))
          query.use { cursor ->
            if (!cursor.moveToFirst() || cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS)) != DownloadManager.STATUS_SUCCESSFUL) {
              finishWithError("APP_UPDATE_DOWNLOAD_FAILED", "The update download did not complete. Check your connection and try again.")
              return
            }
          }

          val fileName = "paisapay-update-${pendingExpectedSha256?.lowercase()?.take(16)}.apk"
          val directory = context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS)
            ?: throw IllegalStateException("Update storage unavailable.")
          val apk = File(directory, fileName)
          val uri = manager.getUriForDownloadedFile(completedId) ?: throw IllegalStateException("Downloaded APK unavailable.")
          val expectedSha256 = pendingExpectedSha256 ?: throw IllegalStateException("Update checksum unavailable.")
          if (!apk.isFile || !sha256(apk).equals(expectedSha256, ignoreCase = true)) {
            finishWithError("APP_UPDATE_INTEGRITY_FAILED", "The downloaded update did not pass its integrity check. It was not opened.")
            return
          }

          verifyPackageAndSigner(apk, pendingExpectedVersion ?: "", pendingExpectedBuildCode ?: -1L)
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !context.packageManager.canRequestPackageInstalls()) {
            finishWithError("APP_UPDATE_PERMISSION_REQUIRED", "Allow PaisaPay to install updates in Android settings, then tap Update Now again.")
            return
          }

          val contentUri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", apk)
          val installIntent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(contentUri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION)
            clipData = ClipData.newRawUri("PaisaPay update", contentUri)
          }
          context.startActivity(installIntent)
          activePromise?.resolve("installer_opened")
          clearActiveDownload()
        } catch (error: UpdateVerificationException) {
          finishWithError(error.errorCode, error.message ?: "The app update did not pass verification.")
        } catch (_: Exception) {
          finishWithError("APP_UPDATE_VERIFICATION_FAILED", "Android could not verify or open this update. The installed app was not changed.")
        }
      }
    }
    downloadReceiver = receiver
    val filter = IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      context.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED)
    } else {
      @Suppress("DEPRECATION")
      context.registerReceiver(receiver, filter)
    }
  }

  private var pendingExpectedSha256: String? = null
  private var pendingExpectedVersion: String? = null
  private var pendingExpectedBuildCode: Long? = null

  private fun verifyPackageAndSigner(apk: File, expectedVersion: String, expectedBuildCode: Long) {
    val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) PackageManager.GET_SIGNING_CERTIFICATES else @Suppress("DEPRECATION") PackageManager.GET_SIGNATURES
    val candidate = context.packageManager.getPackageArchiveInfo(apk.absolutePath, flags)
      ?: throw UpdateVerificationException("APP_UPDATE_PACKAGE_INVALID", "The downloaded file is not a readable Android package.")
    if (candidate.packageName != context.packageName || candidate.versionName != expectedVersion) {
      throw UpdateVerificationException("APP_UPDATE_PACKAGE_MISMATCH", "This APK is not the expected PaisaPay User App release.")
    }
    val candidateCode = versionCode(candidate)
    if (candidateCode != expectedBuildCode) throw UpdateVerificationException("APP_UPDATE_BUILD_MISMATCH", "The APK version does not match the release metadata.")

    val installedFlags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) PackageManager.GET_SIGNING_CERTIFICATES else @Suppress("DEPRECATION") PackageManager.GET_SIGNATURES
    val installed = try { context.packageManager.getPackageInfo(context.packageName, installedFlags) }
      catch (_: PackageManager.NameNotFoundException) { throw UpdateVerificationException("APP_UPDATE_INSTALLED_APP_MISSING", "The installed PaisaPay app could not be verified.") }
    val installedBuildCode = versionCode(installed)
    if (candidateCode <= installedBuildCode) throw UpdateVerificationException("APP_UPDATE_NOT_NEWER", "The downloaded APK is not newer than the installed app.")
    if (signerDigests(candidate) != signerDigests(installed)) {
      throw UpdateVerificationException("APP_UPDATE_SIGNER_MISMATCH", "This update uses a different signing key and cannot safely update the installed app.")
    }
  }

  @Suppress("DEPRECATION")
  private fun signerDigests(info: PackageInfo): Set<String> {
    val signatures = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      info.signingInfo?.apkContentsSigners
    } else {
      info.signatures
    } ?: emptyArray()
    return signatures.map { Base64.encodeToString(MessageDigest.getInstance("SHA-256").digest(it.toByteArray()), Base64.NO_WRAP) }.toSet()
  }

  @Suppress("DEPRECATION")
  private fun versionCode(info: PackageInfo): Long =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) info.longVersionCode else info.versionCode.toLong()

  private fun sha256(file: File): String {
    val digest = MessageDigest.getInstance("SHA-256")
    file.inputStream().buffered().use { input ->
      val buffer = ByteArray(64 * 1024)
      while (true) {
        val count = input.read(buffer)
        if (count < 0) break
        digest.update(buffer, 0, count)
      }
    }
    return digest.digest().joinToString("") { "%02x".format(it) }
  }

  private fun finishWithError(code: String, message: String) {
    activePromise?.reject(code, message)
    clearActiveDownload()
  }

  private fun clearActiveDownload() {
    activePromise = null
    activeDownloadId = null
    pendingExpectedSha256 = null
    pendingExpectedVersion = null
    pendingExpectedBuildCode = null
    unregisterCompletionReceiver()
  }

  private fun unregisterCompletionReceiver() {
    downloadReceiver?.let { receiver ->
      try { context.unregisterReceiver(receiver) } catch (_: IllegalArgumentException) { }
    }
    downloadReceiver = null
  }

  override fun invalidate() {
    clearActiveDownload()
    super.invalidate()
  }
}
