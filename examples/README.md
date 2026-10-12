# 截图演示工作区

这个目录是**给截图演示用的示例工作区**：已接入的语言服务各有一个最简源码文件，
用来展示悬停、补全、跳转定义与诊断能力。

```
examples/
├── feature-tour.md   能一览：标题 / 表格 / 任务列表 / 引用
├── hello.ts          TypeScript · 接口 + 类 + 泛型函数
├── utils.js          JavaScript · 与 hello.ts 同服务，验证多后缀
├── hello.py          Python · dataclass + 类型标注
├── hello.rs          Rust · struct + impl
├── Hello.java        Java · record + stream
├── Hello.cs          C# · record + LINQ
├── Hello.kt          Kotlin · data class + 扩展函数
├── notes/            子目录 1
│   ├── code-lab.md       可直接运行的代码块
│   └── knowledge-tree.md3 树文件（缩进即层级，与大纲联动）
└── web/              子目录 2 · HTML + CSS 配对
```

| 路径 | 语言 / 能力 | 语言服务 |
| --- | --- | --- |
| `hello.ts` `utils.js` | JavaScript / TypeScript | mde.typescript |
| `hello.py` | Python | mde.pyright |
| `hello.rs` | Rust | mde.rust |
| `Hello.java` | Java | mde.java |
| `Hello.cs` | C# | mde.csharp |
| `Hello.kt` | Kotlin | mde.kotlin |
| `web/` | HTML / CSS | mde.html · mde.css |
| `notes/knowledge-tree.md3` | 树文件 · 缩进层级 | 编辑器内置树视图 |
| `notes/code-lab.md` | 代码块运行 | 内置控制台 |

## 为什么是扁平的

源码文件全部放在最外层，只保留 `notes/` 与 `web/` 两个子目录——
它们的作用是**展示目录树能力**（展开、折叠、层级），不是为了按语言分类。
按语言分目录会让目录树变得又深又碎，截图里反而看不出层级关系。

## 维护约定

- 所有文件保持**可直接运行、无诊断错误**，截图时不会出现波浪线；
- 每个文件顶部一句中文说明，方便在截图里辨认用途；
- 新增语言服务时，在最外层补一个同名示例文件，并同步更新上面的表格。
