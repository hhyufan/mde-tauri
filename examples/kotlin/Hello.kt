// Kotlin 示例：数据类、扩展函数与作用域函数。
//
// 用于演示悬停提示、补全、跳转定义与诊断。

data class Note(val title: String, val tags: List<String> = emptyList())

class Notebook {
    private val notes = mutableListOf<Note>()

    fun add(note: Note) = apply { notes += note }

    fun findByTag(tag: String) = notes.filter { tag in it.tags }
}

fun Note.summary(): String = "${title}（${tags.size} 个标签）"

fun main() {
    val notebook = Notebook().add(Note("今天的灵感", listOf("写作")))
    notebook.findByTag("写作").forEach { println(it.summary()) }
}
