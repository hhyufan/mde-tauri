# 代码实验

MokiDown 可以直接**运行代码块**，输出显示在底部控制台，适合边写边验证。

## 第一段：先跑通

```javascript
const ideas = ['记录', '尝试', '连接'];
ideas.forEach((idea, index) => {
  console.log(`${index + 1}. ${idea}`);
});
```

## 第二段：再验证一个想法

```javascript
// 把零散的想法连接起来，看看它们能不能拼成一条线
const notes = [
  { title: '写作', tags: ['输出'] },
  { title: '实验', tags: ['验证', '输出'] },
];

const shared = notes
  .filter((note) => note.tags.includes('输出'))
  .map((note) => note.title);

console.log('共有标签「输出」的笔记：', shared.join('、'));
```

> 运行方式：把光标放进代码块，点右上角的运行按钮，或按 `Ctrl + J` 呼出控制台。
