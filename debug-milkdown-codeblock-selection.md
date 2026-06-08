# Debug Session: milkdown-codeblock-selection
- **Status**: [OPEN]
- **Issue**: Milkdown 代码块语言输入按 Enter 无法提交；点击 mermaid 预览或语言选择器 no result 时偶发 `Selection points outside of document`
- **Debug Server**: http://127.0.0.1:7777/event
- **Log File**: `.dbg/trae-debug-log-milkdown-codeblock-selection.ndjson`

## Reproduction Steps
1. 在所见即所得模式插入代码块。
2. 打开语言选择器并输入一个列表中不存在或需手动确认的语言值。
3. 按 `Enter`，观察是否提交语言、是否报错。
4. 点击 `mermaid` 预览区或语言选择器中的 `No result` 区域，观察是否报 `Selection points outside of document`。

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | Enter 提交语言时与内部 selection 更新冲突 | High | Low | Confirmed |
| B | mermaid/no result 点击路径映射出非法 DOM 位置 | High | Low | Pending |
| C | 当前 keydown 桥接容器不对，拿到的不是当前代码块上下文 | Med | Low | Rejected |
| D | 语言更新后节点重建，焦点回流仍使用旧 selection | High | Med | Pending |
| E | 自定义语言输入不是官方提交路径，默认行为未被正确阻断 | Med | Low | Confirmed |

## Log Evidence
- 已添加运行时埋点：
  - `commitTypedCodeBlockLanguage()` 的 Enter 提交前、`posAtDOM` 后、language 更新后、异常 catch
  - `createNonEditablePreviewSelectionHandler()` 的预览点击前、`posAtDOM` 后、`setSelection` 后、异常 catch
- 关键证据：
  - `commitTypedCodeBlockLanguage:after-posAtDOM` 记录 `pos=5258`、`nodeType=text`，证明原实现命中的是代码块内部文本节点，不是 `code_block`
  - 因 `node.attrs.language` 不存在，原逻辑提前返回 `false`，导致 `Enter` 默认行为继续执行，解释了“不能提交”与后续 selection 异常

## Verification Conclusion
- Pending
