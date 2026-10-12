// C# 示例：记录类型、LINQ 与表达式成员。
//
// 用于演示悬停提示、补全、跳转定义与 Roslyn 的诊断。

using System;
using System.Collections.Generic;
using System.Linq;

namespace MokiDown.Examples;

/// <summary>一条笔记。</summary>
public sealed record Note(string Title, IReadOnlyList<string> Tags);

public sealed class Notebook
{
    private readonly List<Note> _notes = new();

    public Notebook Add(Note note)
    {
        _notes.Add(note);
        return this;
    }

    public IEnumerable<Note> FindByTag(string tag) =>
        _notes.Where(note => note.Tags.Contains(tag));

    public static void Main()
    {
        var notebook = new Notebook().Add(new Note("今天的灵感", new[] { "写作" }));
        Console.WriteLine(string.Join(", ", notebook.FindByTag("写作").Select(note => note.Title)));
    }
}
