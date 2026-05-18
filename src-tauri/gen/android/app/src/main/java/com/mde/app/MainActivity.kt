package com.mde.app

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts

class MainActivity : TauriActivity() {

    // 持久化保存 SAF picker 的回调 ID。Activity 可能在 picker 期间被销毁重建
    // （横竖屏切换 / 系统内存压力），所以用 onSaveInstanceState 持久化。
    private var pendingFolderCb: Long = 0L
    private var pendingFileCb: Long = 0L
    private var pendingCreateCb: Long = 0L

    private lateinit var folderLauncher: ActivityResultLauncher<Uri?>
    private lateinit var fileLauncher: ActivityResultLauncher<Array<String>>
    private lateinit var createLauncher: ActivityResultLauncher<String>

    // TauriActivity 不一定对外暴露 WebView 字段；我们在 onWebViewCreate 里
    // 主动持有一份，picker 回调回填 JS 也走这个引用。
    private var webViewRef: WebView? = null

    /**
     * 在 SafBridge.pickFolder/pickFile/pickSaveFile 被调用前，桥接已经在
     * onWebViewCreate 里挂好。bridge 自己持有 host=MainActivity，
     * 因此 picker 的 callback 信息（id、mime 列表等）由 host 这边维护。
     */
    private val safBridge: SafBridge by lazy { SafBridge(this) }

    override fun onCreate(savedInstanceState: Bundle?) {
        // 恢复活动重建前未完成的回调 ID，避免 picker 返回后找不到对应 promise
        if (savedInstanceState != null) {
            pendingFolderCb = savedInstanceState.getLong(KEY_FOLDER_CB, 0L)
            pendingFileCb = savedInstanceState.getLong(KEY_FILE_CB, 0L)
            pendingCreateCb = savedInstanceState.getLong(KEY_CREATE_CB, 0L)
        }

        // ActivityResultLauncher 必须在 STARTED 之前注册（即 onCreate / 字段初始化阶段），
        // 否则会抛 IllegalStateException。
        folderLauncher = registerForActivityResult(
            ActivityResultContracts.OpenDocumentTree()
        ) { uri ->
            val cb = pendingFolderCb
            pendingFolderCb = 0L
            if (uri != null) {
                takePersistableSafe(uri)
            }
            resolveCallback(cb, uri?.toString())
        }

        fileLauncher = registerForActivityResult(
            ActivityResultContracts.OpenDocument()
        ) { uri ->
            val cb = pendingFileCb
            pendingFileCb = 0L
            if (uri != null) {
                takePersistableSafe(uri)
            }
            resolveCallback(cb, uri?.toString())
        }

        createLauncher = registerForActivityResult(
            ActivityResultContracts.CreateDocument("*/*")
        ) { uri ->
            val cb = pendingCreateCb
            pendingCreateCb = 0L
            if (uri != null) {
                takePersistableSafe(uri)
            }
            resolveCallback(cb, uri?.toString())
        }

        enableEdgeToEdge()
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        super.onCreate(savedInstanceState)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        outState.putLong(KEY_FOLDER_CB, pendingFolderCb)
        outState.putLong(KEY_FILE_CB, pendingFileCb)
        outState.putLong(KEY_CREATE_CB, pendingCreateCb)
        super.onSaveInstanceState(outState)
    }

    /**
     * Tauri 在 WebView 创建完成后会回调到这里（参见 TauriActivity）。把
     * SafBridge 通过 `addJavascriptInterface` 注入成 `window.AndroidSaf`，
     * 前端通过它访问 SAF。
     *
     * 注意：addJavascriptInterface 暴露给 Web 的接口必须信任来源。这里
     * WebView 加载的就是我们自己的前端（asset bundle / localhost），没有
     * 加载第三方 URL，所以不会有泄漏风险。
     */
    override fun onWebViewCreate(webView: WebView) {
        super.onWebViewCreate(webView)
        webViewRef = webView
        webView.addJavascriptInterface(safBridge, "AndroidSaf")
    }

    // ---------------------------------------------------------------------
    // 给 SafBridge 调用的入口（必须切到 UI 线程；bridge 自己跑在 binder 线程）
    // ---------------------------------------------------------------------

    fun launchPickFolder(callbackId: Long, initialUri: String?) {
        pendingFolderCb = callbackId
        runOnUiThread {
            try {
                folderLauncher.launch(initialUri?.let { Uri.parse(it) })
            } catch (e: Throwable) {
                pendingFolderCb = 0L
                resolveCallback(callbackId, null)
            }
        }
    }

    fun launchPickFile(callbackId: Long, mimeTypes: Array<String>) {
        pendingFileCb = callbackId
        runOnUiThread {
            try {
                fileLauncher.launch(mimeTypes)
            } catch (e: Throwable) {
                pendingFileCb = 0L
                resolveCallback(callbackId, null)
            }
        }
    }

    @Suppress("UNUSED_PARAMETER")
    fun launchCreateFile(callbackId: Long, suggestedName: String, mimeType: String) {
        pendingCreateCb = callbackId
        runOnUiThread {
            try {
                // CreateDocument 的 mime 是 contract 的构造参数，这里每次都新建一个 launcher
                // 太重；但 ActivityResultContracts.CreateDocument 在 androidx.activity 1.6+
                // 提供了通过 launcher.launch 的 input 修改 displayName 的能力（mime 仍以
                // contract 为准），所以这里只把 mime 设成 "*/*"，最终类型由系统按
                // 扩展名推断；用户在 SAF UI 上可以自由改名。
                createLauncher.launch(suggestedName)
            } catch (e: Throwable) {
                pendingCreateCb = 0L
                resolveCallback(callbackId, null)
            }
        }
    }

    // ---------------------------------------------------------------------
    // 工具方法
    // ---------------------------------------------------------------------

    /**
     * 把 picker 结果回写到 JS：调用前端预先挂在 window 上的解析函数
     * `__androidSafResolve(callbackId, payload)`。payload 是字符串 URI 或 null。
     */
    private fun resolveCallback(callbackId: Long, value: String?) {
        if (callbackId <= 0L) return
        val wv = webViewRef ?: return
        val payload = if (value == null) "null" else "\"${escapeForJs(value)}\""
        val js = "if(window.__androidSafResolve){window.__androidSafResolve($callbackId, $payload);}"
        wv.post { wv.evaluateJavascript(js, null) }
    }

    /**
     * 把 URI 的读写权限固化下来，重启 App 后依然可用；releasePersistableUriPermission
     * 反向操作在 SafBridge.releaseUri 里。
     *
     * 某些 provider 不支持 takePersistableUriPermission（比如部分云盘 DocumentsProvider），
     * 这种情况直接吞掉异常即可，picker 给的临时权限在当前进程内还是有效的。
     */
    private fun takePersistableSafe(uri: Uri) {
        try {
            contentResolver.takePersistableUriPermission(
                uri,
                Intent.FLAG_GRANT_READ_URI_PERMISSION or
                    Intent.FLAG_GRANT_WRITE_URI_PERMISSION,
            )
        } catch (_: Throwable) {
        }
    }

    private fun escapeForJs(s: String): String =
        s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n").replace("\r", "\\r")

    companion object {
        private const val KEY_FOLDER_CB = "saf_folder_cb"
        private const val KEY_FILE_CB = "saf_file_cb"
        private const val KEY_CREATE_CB = "saf_create_cb"
    }
}
