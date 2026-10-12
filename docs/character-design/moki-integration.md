# Moki 在 MokiDown 中的融合

当前方案为「欢迎页半身形象 + 清晰任务入口 + 周边符号轻动效」。编辑区写作伙伴功能已移除。

## 明暗形象

两版共用蓝色短发、圆脸蓝眼与 M↓ 发饰，通过表情、姿势和配色共同区分主题。

- 晴笺 · 浅色：探身挥手、睁眼开怀笑，纸白与雾蓝服装，合上的笔记本搭配太阳书扣。
- 夜读 · 深色：歪头托腮、微眯眼微笑，墨蓝服装，打开的笔记本搭配月牙书扣。
- 使用面部占比更大的半身构图；主题卡片显示 88px 人像，避免全身像缩小后五官难辨。
- 人物为静态图片，不拆层、不变形、不响应点击切换姿势。

## 界面与设置

- 欢迎页突出新建文档，说明打开文件和打开文件夹的用途，展示当前账号最近文档。
- `#`、`</>`、`[]` 等 Markdown 符号在欢迎页人物周围缓慢飘散，装饰不拦截点击，对辅助技术隐藏。
- 「设置 → 外观」只提供欢迎页人物显示/隐藏与周边轻动效开关，动效遵从系统减少动态效果偏好。
- 编辑区不显示人物或提示气泡；写作伙伴显示选项、大小滑块、收起按钮和状态切换均已移除。
- 原有本地或导入快照中的 `companion` 自动转为 `welcome`；旧大小和收起状态不再导出。

## 素材与组件

- 当前素材：`src/assets/characters/moki-day-night-bust.png`，1774 × 887 双主题半身图。[生成记录与提示词](moki-day-night-bust-prompt.md)。
- 之前的全身图与同姿势半身图保留作设计参考，不在当前产品界面使用。
- `MokiSprite.jsx` 显示静态形象；`MokiAmbient.jsx` 与 `moki.scss` 管理 CSS 符号动效，无人物动画库或 Canvas 渲染。

早期参考项目为 [VPet](https://github.com/LorisYounger/VPet)、[Doki Theme](https://github.com/doki-theme/doki-theme-vscode) 和 [Live2D Widget](https://github.com/stevenjoezhang/live2d-widget)。当前实现采用本项目原创插画和欢迎页装饰。

## README 截图

截图来自实际 React 界面，使用隔离浏览器上下文与示例文档。桌面视口 1600 × 1000，窄屏 390 × 844。

| 文件 | 内容 |
| --- | --- |
| welcome-light.png / welcome-dark.png | 双主题形象、任务入口与符号 |
| editor.png / editor-dark.png / main.png | 完整编辑区，无写作伙伴 |
| moki-settings.png | 双主题半身卡片与欢迎页设置 |
| wysiwyg.png / mode-switch.gif | 编辑模式展示 |
| tree.png | 知识树 |
| code-run.png | 代码输出演示 |
| sync-conflict.png | 同步冲突界面演示 |
| welcome-mobile.png | 窄屏欢迎页 |

代码执行输出和同步冲突来自演示数据，用真实组件展示，不代表浏览器能够启动桌面执行引擎或已经连接同步服务。截图脚本也检查周边动效开关、系统减少动态效果、编辑区不显示人物，以及窄屏无水平溢出。

```powershell
$env:MDE_SCREENSHOT_RUNTIME = '<包含 playwright 和 sharp 的 node_modules 路径>'
$env:MDE_SCREENSHOT_URL = 'http://127.0.0.1:1422'
node scripts/capture-moki.mjs
```
