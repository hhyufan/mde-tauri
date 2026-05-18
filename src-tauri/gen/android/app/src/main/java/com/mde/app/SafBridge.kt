package com.mde.app

import android.content.ContentUris
import android.content.Intent
import android.database.Cursor
import android.net.Uri
import android.os.Looper
import android.provider.DocumentsContract
import android.util.Base64
import android.webkit.JavascriptInterface
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong

/**
 * 同步 SAF 操作通过 WebView 的 JavaScriptInterface 暴露给前端。
 *
 * `pick*` 系列方法是异步的：它们立即返回一个递增的 callbackId，真正的
 * 结果由 MainActivity 在 ActivityResultLauncher 回调里写回到
 * `window.__androidSafResolve(callbackId, payload)`。其他方法都是同步的
 * （JS 侧由 androidSaf.js 包成 Promise 仅是为了和 picker API 形态保持一致）。
 *
 * 注意 @JavascriptInterface 标注的方法运行在 WebView 的 binder/worker
 * 线程，不在 UI 线程；因此可以直接做 IO，但启动 Activity 必须切回 UI 线程。
 */
class SafBridge(private val host: MainActivity) {

    private val idSeq = AtomicLong(1)
    fun nextId(): Long = idSeq.getAndIncrement()

    // ---------------------------------------------------------------------
    // 异步 picker / 创建文件 —— 真正的返回值通过 MainActivity 的
    // ActivityResultLauncher 走 evaluateJavascript 回填
    // ---------------------------------------------------------------------

    /** 让用户选择一个目录，授予持久化读写权限。返回 callbackId。 */
    @JavascriptInterface
    fun pickFolder(initialUri: String?): Long {
        val id = nextId()
        host.launchPickFolder(id, initialUri)
        return id
    }

    /** 让用户选择一个文件，授予持久化读写权限。返回 callbackId。 */
    @JavascriptInterface
    fun pickFile(mimeTypesJson: String?): Long {
        val id = nextId()
        val mimes = parseStringArray(mimeTypesJson)
        host.launchPickFile(id, mimes)
        return id
    }

    /** 让用户选择「保存为」目标位置；返回 callbackId，结果是新文件的 URI。 */
    @JavascriptInterface
    fun pickSaveFile(suggestedName: String?, mimeType: String?): Long {
        val id = nextId()
        host.launchCreateFile(id, suggestedName ?: "untitled.md", mimeType ?: "text/markdown")
        return id
    }

    // ---------------------------------------------------------------------
    // 当前授权状态
    // ---------------------------------------------------------------------

    /** 列出当前进程持有持久化权限的 URI（重启后仍然可用）。 */
    @JavascriptInterface
    fun listPersistedUris(): String {
        val arr = JSONArray()
        host.contentResolver.persistedUriPermissions.forEach { p ->
            val obj = JSONObject()
                .put("uri", p.uri.toString())
                .put("read", p.isReadPermission)
                .put("write", p.isWritePermission)
                .put("time", p.persistedTime)
            arr.put(obj)
        }
        return arr.toString()
    }

    /** 主动释放持久化权限（用户在前端解除收藏目录时用）。 */
    @JavascriptInterface
    fun releaseUri(uriStr: String): Boolean {
        return try {
            val uri = Uri.parse(uriStr)
            val flags = Intent.FLAG_GRANT_READ_URI_PERMISSION or
                    Intent.FLAG_GRANT_WRITE_URI_PERMISSION
            host.contentResolver.releasePersistableUriPermission(uri, flags)
            true
        } catch (_: Throwable) {
            false
        }
    }

    // ---------------------------------------------------------------------
    // 目录列表 / 文件信息
    // ---------------------------------------------------------------------

    /**
     * 列出 tree URI 下的直接子项。返回 JSON 数组，结构和桌面端
     * `get_directory_contents` 命令对齐，前端不需要再分情况渲染。
     *
     *   [{ name, path, uri, is_file, is_dir, size, modified }, ...]
     *
     * 这里同时输出 `path` 与 `uri`：`path` 是给现有代码当主键用的 `content://`
     * 形式 child document URI；`uri` 是同一个值的别名，方便后续扩展时区分。
     */
    @JavascriptInterface
    fun listFolder(treeUri: String): String {
        val arr = JSONArray()
        try {
            val tree = Uri.parse(treeUri)
            val docId = documentIdForTreeOrDocument(tree)
            val childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(tree, docId)
            val projection = arrayOf(
                DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                DocumentsContract.Document.COLUMN_MIME_TYPE,
                DocumentsContract.Document.COLUMN_SIZE,
                DocumentsContract.Document.COLUMN_LAST_MODIFIED,
            )
            host.contentResolver.query(childrenUri, projection, null, null, null)?.use { c ->
                val idIdx = c.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_DOCUMENT_ID)
                val nameIdx = c.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_DISPLAY_NAME)
                val mimeIdx = c.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_MIME_TYPE)
                val sizeIdx = c.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_SIZE)
                val modIdx = c.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_LAST_MODIFIED)
                while (c.moveToNext()) {
                    val childId = c.getString(idIdx)
                    val name = c.getString(nameIdx) ?: ""
                    val mime = c.getString(mimeIdx) ?: ""
                    val size = if (c.isNull(sizeIdx)) 0L else c.getLong(sizeIdx)
                    val modified = if (c.isNull(modIdx)) 0L else c.getLong(modIdx)
                    val childUri = DocumentsContract.buildDocumentUriUsingTree(tree, childId)
                    val isDir = mime == DocumentsContract.Document.MIME_TYPE_DIR
                    val obj = JSONObject()
                        .put("name", name)
                        .put("path", childUri.toString())
                        .put("uri", childUri.toString())
                        .put("is_file", !isDir)
                        .put("is_dir", isDir)
                        .put("size", size)
                        // DocumentsContract 用毫秒，桌面端 metadata 用秒；这里换算成秒以保持一致
                        .put("modified", modified / 1000)
                        .put("mime_type", mime)
                    arr.put(obj)
                }
            }
        } catch (e: Throwable) {
            return errorJson(e.message ?: e.toString())
        }
        return arr.toString()
    }

    /** 把 tree URI 自己的元信息也拿出来（前端用来显示 currentDir 名字）。 */
    @JavascriptInterface
    fun statUri(uriStr: String): String {
        return try {
            val uri = Uri.parse(uriStr)
            val docUri = toDocumentUri(uri) ?: return errorJson("Invalid URI")
            val projection = arrayOf(
                DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                DocumentsContract.Document.COLUMN_MIME_TYPE,
                DocumentsContract.Document.COLUMN_SIZE,
                DocumentsContract.Document.COLUMN_LAST_MODIFIED,
            )
            host.contentResolver.query(docUri, projection, null, null, null)?.use { c ->
                if (!c.moveToFirst()) return errorJson("Not found")
                val name = c.getString(0) ?: ""
                val mime = c.getString(1) ?: ""
                val size = if (c.isNull(2)) 0L else c.getLong(2)
                val modified = if (c.isNull(3)) 0L else c.getLong(3)
                val isDir = mime == DocumentsContract.Document.MIME_TYPE_DIR
                JSONObject()
                    .put("name", name)
                    .put("path", docUri.toString())
                    .put("uri", docUri.toString())
                    .put("is_file", !isDir)
                    .put("is_dir", isDir)
                    .put("size", size)
                    .put("modified", modified / 1000)
                    .put("mime_type", mime)
                    .toString()
            } ?: errorJson("Query failed")
        } catch (e: Throwable) {
            errorJson(e.message ?: e.toString())
        }
    }

    /** 检查 tree 下是否存在指定名字的子项。 */
    @JavascriptInterface
    fun childExists(treeUri: String, name: String): Boolean {
        return findChild(Uri.parse(treeUri), name) != null
    }

    /** tree 下按名字解析出 child URI；不存在时返回 null。 */
    @JavascriptInterface
    fun resolveChild(treeUri: String, name: String): String? {
        return findChild(Uri.parse(treeUri), name)?.toString()
    }

    // ---------------------------------------------------------------------
    // 文件 IO（Base64 通道，避免在 JS bridge 上做 UTF-16/UTF-8 二次转换出错）
    // ---------------------------------------------------------------------

    /**
     * 读取文件内容。返回 JSON：
     *   { "ok": true, "content_base64": "...", "size": N, "modified": ms, "name": "..." }
     * JS 侧 atob/TextDecoder 解码成 UTF-8 字符串。
     */
    @JavascriptInterface
    fun readFile(uriStr: String): String {
        return try {
            val uri = Uri.parse(uriStr)
            val bytes = host.contentResolver.openInputStream(uri)?.use { input ->
                val buf = ByteArrayOutputStream()
                val tmp = ByteArray(8192)
                while (true) {
                    val n = input.read(tmp)
                    if (n <= 0) break
                    buf.write(tmp, 0, n)
                }
                buf.toByteArray()
            } ?: return errorJson("openInputStream returned null")

            JSONObject()
                .put("ok", true)
                .put("content_base64", Base64.encodeToString(bytes, Base64.NO_WRAP))
                .put("size", bytes.size)
                .toString()
        } catch (e: Throwable) {
            errorJson(e.message ?: e.toString())
        }
    }

    /**
     * 写入文件内容。`contentBase64` 是 JS 端 base64 编码的 UTF-8 字节流；
     * 用 truncate mode (`"wt"`) 打开输出流，防止旧内容残留导致比 sourceSize 短时
     * 末尾还留着上次的数据。
     */
    @JavascriptInterface
    fun writeFile(uriStr: String, contentBase64: String): String {
        return try {
            val uri = Uri.parse(uriStr)
            val bytes = Base64.decode(contentBase64, Base64.NO_WRAP)
            host.contentResolver.openOutputStream(uri, "wt")?.use { out ->
                out.write(bytes)
                out.flush()
            } ?: return errorJson("openOutputStream returned null")
            JSONObject().put("ok", true).put("size", bytes.size).toString()
        } catch (e: Throwable) {
            errorJson(e.message ?: e.toString())
        }
    }

    // ---------------------------------------------------------------------
    // 增删改
    // ---------------------------------------------------------------------

    /** 在 tree 下新建文件；如同名已存在直接返回错误（让前端走「文件已存在」分支）。 */
    @JavascriptInterface
    fun createFile(treeUri: String, displayName: String, mimeType: String?): String {
        return try {
            val tree = Uri.parse(treeUri)
            if (findChild(tree, displayName) != null) {
                return errorJson("AlreadyExists")
            }
            val docId = documentIdForTreeOrDocument(tree)
            val parentUri = DocumentsContract.buildDocumentUriUsingTree(tree, docId)
            val mime = mimeType ?: guessMime(displayName)
            val newUri = DocumentsContract.createDocument(
                host.contentResolver, parentUri, mime, displayName
            ) ?: return errorJson("createDocument returned null")
            JSONObject().put("ok", true).put("uri", newUri.toString()).toString()
        } catch (e: Throwable) {
            errorJson(e.message ?: e.toString())
        }
    }

    /** 创建子目录；同名已存在则返回错误。 */
    @JavascriptInterface
    fun createSubdir(treeUri: String, displayName: String): String {
        return try {
            val tree = Uri.parse(treeUri)
            if (findChild(tree, displayName) != null) {
                return errorJson("AlreadyExists")
            }
            val docId = documentIdForTreeOrDocument(tree)
            val parentUri = DocumentsContract.buildDocumentUriUsingTree(tree, docId)
            val newUri = DocumentsContract.createDocument(
                host.contentResolver,
                parentUri,
                DocumentsContract.Document.MIME_TYPE_DIR,
                displayName,
            ) ?: return errorJson("createDocument returned null")
            JSONObject().put("ok", true).put("uri", newUri.toString()).toString()
        } catch (e: Throwable) {
            errorJson(e.message ?: e.toString())
        }
    }

    @JavascriptInterface
    fun deleteUri(uriStr: String): Boolean {
        return try {
            DocumentsContract.deleteDocument(host.contentResolver, Uri.parse(uriStr))
        } catch (_: Throwable) {
            false
        }
    }

    /**
     * 重命名。SAF 在 API 21+ 提供 `renameDocument`，新返回的 URI 可能因为 docId
     * 变化而变化（多见于第三方 DocumentsProvider），调用方必须用新 URI 替换旧值。
     */
    @JavascriptInterface
    fun renameUri(uriStr: String, newName: String): String {
        return try {
            val newUri = DocumentsContract.renameDocument(
                host.contentResolver, Uri.parse(uriStr), newName
            ) ?: return errorJson("renameDocument returned null")
            JSONObject().put("ok", true).put("uri", newUri.toString()).toString()
        } catch (e: Throwable) {
            errorJson(e.message ?: e.toString())
        }
    }

    // ---------------------------------------------------------------------
    // 打开系统文件管理器
    // ---------------------------------------------------------------------

    /**
     * 用系统的 DocumentsUI 打开传入的目录/文件。
     *
     * Android 没有「在 Explorer 中显示并选中」这种功能，能做到的极限是
     * 让 DocumentsUI 跳到对应的目录视图；这里走 `ACTION_VIEW`，并附带
     * 读权限 flag，绝大多数 OEM 的 Files / DocumentsUI 都能识别。
     */
    @JavascriptInterface
    fun openInFileManager(uriStr: String): Boolean {
        val source = try {
            Uri.parse(uriStr)
        } catch (_: Throwable) {
            return false
        }

        val target = toDocumentUri(source) ?: source
        val done = CountDownLatch(1)
        var opened = false

        val open = {
            opened = tryOpenDocumentView(target) || tryOpenDocumentTreeAt(source)
            done.countDown()
        }

        if (Looper.myLooper() == Looper.getMainLooper()) {
            open()
        } else {
            host.runOnUiThread(open)
            done.await(2, TimeUnit.SECONDS)
        }
        return opened
    }

    // ---------------------------------------------------------------------
    // 内部工具
    // ---------------------------------------------------------------------

    private fun errorJson(message: String): String =
        JSONObject().put("ok", false).put("message", message).toString()

    private fun parseStringArray(json: String?): Array<String> {
        if (json.isNullOrBlank()) return arrayOf("*/*")
        return try {
            val arr = JSONArray(json)
            Array(arr.length()) { arr.getString(it) }.ifEmpty { arrayOf("*/*") }
        } catch (_: Throwable) {
            arrayOf("*/*")
        }
    }

    /**
     * tree URI 自己也是一个 document，但 DocumentsContract.getDocumentId(tree) 在
     * Android < O 上会抛异常；用 treeDocumentId 兜底。
     */
    private fun treeDocumentId(tree: Uri): String {
        return try {
            DocumentsContract.getTreeDocumentId(tree)
        } catch (_: Throwable) {
            // 退回旧 API
            DocumentsContract.getDocumentId(tree)
        }
    }

    /**
     * SAF child directories arrive as tree-backed document URIs:
     * `.../tree/root/document/root/child`. For those, `getTreeDocumentId`
     * still returns the root id, so list/create operations would keep acting
     * on the workspace root. Prefer the concrete document id when present.
     */
    private fun documentIdForTreeOrDocument(uri: Uri): String {
        return try {
            DocumentsContract.getDocumentId(uri)
        } catch (_: Throwable) {
            treeDocumentId(uri)
        }
    }

    /** tree URI → 该目录自身对应的 document URI（用来作为父节点）。 */
    private fun toDocumentUri(uri: Uri): Uri? {
        return try {
            if (DocumentsContract.isTreeUri(uri)) {
                DocumentsContract.buildDocumentUriUsingTree(uri, documentIdForTreeOrDocument(uri))
            } else {
                uri
            }
        } catch (_: Throwable) {
            uri
        }
    }

    private fun tryOpenDocumentView(uri: Uri): Boolean {
        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, host.contentResolver.getType(uri) ?: "*/*")
            addFlags(
                Intent.FLAG_GRANT_READ_URI_PERMISSION or
                    Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
                    Intent.FLAG_ACTIVITY_NEW_TASK
            )
        }
        return runCatching {
            host.startActivity(intent)
            true
        }.getOrDefault(false)
    }

    private fun tryOpenDocumentTreeAt(uri: Uri): Boolean {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
            putExtra("android.provider.extra.INITIAL_URI", uri)
            addFlags(
                Intent.FLAG_GRANT_READ_URI_PERMISSION or
                    Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
                    Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION or
                    Intent.FLAG_ACTIVITY_NEW_TASK
            )
        }
        return runCatching {
            host.startActivity(intent)
            true
        }.getOrDefault(false)
    }

    /** 在 tree 下按 displayName 查找子项，返回它的 document URI。 */
    private fun findChild(tree: Uri, name: String): Uri? {
        val docId = documentIdForTreeOrDocument(tree)
        val childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(tree, docId)
        val projection = arrayOf(
            DocumentsContract.Document.COLUMN_DOCUMENT_ID,
            DocumentsContract.Document.COLUMN_DISPLAY_NAME,
        )
        host.contentResolver.query(childrenUri, projection, null, null, null)?.use { c ->
            val idIdx = c.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_DOCUMENT_ID)
            val nameIdx = c.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_DISPLAY_NAME)
            while (c.moveToNext()) {
                if (c.getString(nameIdx) == name) {
                    val childId = c.getString(idIdx)
                    return DocumentsContract.buildDocumentUriUsingTree(tree, childId)
                }
            }
        }
        return null
    }

    private fun guessMime(name: String): String {
        val dot = name.lastIndexOf('.')
        if (dot < 0) return "application/octet-stream"
        return when (name.substring(dot + 1).lowercase()) {
            "md", "markdown", "mdx" -> "text/markdown"
            "txt" -> "text/plain"
            "json" -> "application/json"
            "html", "htm" -> "text/html"
            "xml" -> "application/xml"
            "css" -> "text/css"
            "js", "mjs" -> "application/javascript"
            "ts" -> "application/typescript"
            "png" -> "image/png"
            "jpg", "jpeg" -> "image/jpeg"
            "gif" -> "image/gif"
            "svg" -> "image/svg+xml"
            else -> "application/octet-stream"
        }
    }
}

// 让 ContentUris 可见，避免 Kotlin 编译时未使用 import 警告（保留以便后续扩展）
@Suppress("unused")
private val _keep = ContentUris::class.java
@Suppress("unused")
private val _keep2: Cursor? = null
