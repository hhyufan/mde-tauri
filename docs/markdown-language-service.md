# Markdown 语言服务

在桌面版的「设置 → 语言服务」中搜索 **Markdown · Marksman**，点击安装即可。
安装后默认启用；源码编辑或分栏模式下的 Markdown 文档会接入服务。
支持 `.md`、`.markdown`、`.mdown`、`.mdwn`、`.mkd`、`.mkdn`。
Marksman 使用独立程序，不需要额外安装 Node.js 或 .NET。

在 Markdown 链接路径、`#` 标题锚点及 `[[Wiki 链接]]` 中输入时可以触发补全，
也可以使用编辑器的补全快捷键。已有的定义跳转、引用查找和悬停入口接入同一个服务；
无效文档引用的诊断显示在编辑器和问题面板中。禁用或卸载服务会清理贡献和诊断。
所见即所得模式继续使用 Milkdown 的渲染和输入规则；此模式暂不显示 LSP 补全菜单。

普通 Markdown 链接的 `.` / `./` 以当前文档所在目录为起点，`..` / `../` 指向其上级目录。
目录候选带 `/`，选择后继续补全目录内容；文件候选写入文档相对路径，支持 Ctrl+点击打开。
Marksman 返回的工作区路径会转换成文档相对路径；空格、中文和 `#` 等文件名字符会正确编码。

普通文件夹使用当前文档目录作为工作区；若上级存在 `.marksman.toml` 或 Git 仓库，
则使用最近的项目目录。跨目录笔记建议在根目录放置空的 `.marksman.toml`。
未保存文档使用应用的临时文件目录，因此跨文件链接功能应在保存后使用。

实现复用了现有插件安装器、LSP 会话管理、Monaco provider 和问题面板。
插件固定使用 `2026-02-08` 发布版本，按平台选择官方 Windows、Linux 或 macOS 程序。
平台资产选择失败时会明确报错，不会下载其他架构的文件。

验证实际服务器：

```powershell
node scripts/markdown-lsp-smoke.mjs 'C:\path\to\marksman.exe'
```

脚本创建隔离的临时笔记目录，验证链接补全、跨文件定义跳转及不存在文档的诊断，结束后清理。
Rust 的在线插件测试另外覆盖下载、安装、初始化和卸载流程。

参考：[Marksman 功能](https://github.com/artempyanykh/marksman/blob/main/docs/features.md)、
[官方发布](https://github.com/artempyanykh/marksman/releases/tag/2026-02-08)。
