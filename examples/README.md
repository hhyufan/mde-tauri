# 截图演示工作区

这个文件夹是**给截图演示用的示例工作区**：每个目录对应一个已接入的语言服务，
里面放一个能正常解析的最简源码文件，用来展示悬停、补全、跳转、诊断等能力。

| 目录 | 语言 | 语言服务 |
| --- | --- | --- |
| `typescript/` | JavaScript / TypeScript | mde.typescript |
| `python/` | Python | mde.pyright |
| `rust/` | Rust | mde.rust |
| `java/` | Java | mde.java |
| `csharp/` | C# | mde.csharp |
| `kotlin/` | Kotlin | mde.kotlin |
| `web/` | HTML / CSS | mde.html · mde.css |

约定：

- 文件都保持**可直接运行/无诊断错误**，截图时不会出现错误提示；
- 每个文件顶部写一句中文说明，方便在截图里辨认用途；
- 新增语言服务时，在这里补一个同名目录与最简示例。
