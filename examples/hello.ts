/**
 * TypeScript 示例：接口、类与泛型函数。
 * 用于演示悬停提示、补全、跳转定义与类型检查。
 */
export interface Note {
  title: string;
  tags: string[];
}

export class Notebook {
  private readonly notes: Note[] = [];

  add(note: Note): this {
    this.notes.push(note);
    return this;
  }

  findByTag(tag: string): Note[] {
    return this.notes.filter((note) => note.tags.includes(tag));
  }

  get size(): number {
    return this.notes.length;
  }
}

export function first<T>(items: T[]): T | undefined {
  return items[0];
}

const notebook = new Notebook()
  .add({ title: '今天的灵感', tags: ['写作'] })
  .add({ title: '代码实验', tags: ['实践', '写作'] });

console.log(first(notebook.findByTag('写作'))?.title, notebook.size);
