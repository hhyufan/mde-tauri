"""Python 示例：数据类与函数。

用于演示悬停提示、补全、跳转定义与 Pyright 类型检查。
"""

from dataclasses import dataclass, field


@dataclass
class Note:
    title: str
    tags: list[str] = field(default_factory=list)


class Notebook:
    def __init__(self) -> None:
        self.notes: list[Note] = []

    def add(self, note: Note) -> "Notebook":
        self.notes.append(note)
        return self

    def find_by_tag(self, tag: str) -> list[Note]:
        return [note for note in self.notes if tag in note.tags]


def main() -> None:
    notebook = Notebook().add(Note("今天的灵感", ["写作"]))
    found = notebook.find_by_tag("写作")
    print(found[0].title if found else "还没有笔记")


if __name__ == "__main__":
    main()
