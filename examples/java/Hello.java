/**
 * Java 示例：类、泛型方法与流式调用。
 *
 * 用于演示悬停提示、补全、跳转定义与 Eclipse JDT 的诊断。
 */
import java.util.ArrayList;
import java.util.List;

public class Hello {

    /** 一条笔记。 */
    public record Note(String title, List<String> tags) {}

    private final List<Note> notes = new ArrayList<>();

    public Hello add(Note note) {
        notes.add(note);
        return this;
    }

    public List<Note> findByTag(String tag) {
        return notes.stream().filter(note -> note.tags().contains(tag)).toList();
    }

    public static void main(String[] args) {
        Hello notebook = new Hello().add(new Note("今天的灵感", List.of("写作")));
        System.out.println(notebook.findByTag("写作"));
    }
}
