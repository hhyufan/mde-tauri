# mutation 队列调度

## 功能是什么

使用队列处理 upsert、bind_path、delete 等同步动作，并支持去重与重试。

## 对应代码在哪

- 代码位置：[useSyncStore.js](../../../src/store/useSyncStore.js)
  符号：`enqueueMutation / getReadyMutation / completeMutation / failMutation`
  作用：mutation 队列的数据结构和生命周期。
- 代码位置：[syncEngine.js](../../../src/services/syncEngine.js)
  符号：`processMutation / processQueue`
  作用：按顺序消费 upsert、bind_path、delete。
- 代码位置：[syncEngine.js](../../../src/services/syncEngine.js)
  符号：`queueLocalUpsert / bindLocalPath / deleteDocument`
  作用：为不同动作生成 mutation。

## 关键代码怎么读

- 第一步看 [useSyncStore.js](../../../src/store/useSyncStore.js) 中的 `enqueueMutation / getReadyMutation / completeMutation / failMutation`，其作用是：mutation 队列的数据结构和生命周期。
- 第二步看 [syncEngine.js](../../../src/services/syncEngine.js) 中的 `processMutation / processQueue`，其作用是：按顺序消费 upsert、bind_path、delete。
- 第三步看 [syncEngine.js](../../../src/services/syncEngine.js) 中的 `queueLocalUpsert / bindLocalPath / deleteDocument`，其作用是：为不同动作生成 mutation。

## 论文里是怎么定义这个功能的

- `1.3.2`
- `5.3`

## 协作建议

- 上级模块：[云同步模块](./F-03-云同步模块.md)
- 这是一份单功能文档，适合后续继续补“输入输出”“状态变化”“测试场景”“异常处理”。
- 如果后续要对应源码细讲，建议直接在本文件下新增“关键流程时序”小节。
