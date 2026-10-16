// 这几个弹窗用的是模块级 i18n（不接 useTranslation），测试环境默认走英文语言表，
// 而本文件的断言写的是中文。按仓库既有做法（见 FileTree.delete / History 等）显式 mock。
vi.mock('@/i18n', () => ({
  default: {
    t: (key) =>
      ({
        'sync.conflict.removedMessage': '原文件已被删除或移动',
        'sync.conflict.changedMessage': '磁盘内容与本地编辑内容冲突',
        'sync.conflict.local': '本地编辑内容',
        'sync.conflict.remote': '磁盘内容',
        'sync.conflict.noticeRemoved': '文件已被删除或移动',
        'sync.conflict.noticeChanged': '文件在外部发生变化，自动保存已暂停',
        'sync.conflict.review': '查看并处理',
      })[key] ?? key,
  },
}));
import * as React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ExternalFileConflictNotice from './ExternalFileConflictNotice';

vi.mock('./ExternalFileConflictModal', () => ({
  default: ({ onClose }) => <div role="dialog"><button onClick={onClose}>稍后处理</button></div>,
}));

describe('external file conflict notification', () => {
  it('keeps focus on the composing input and opens a review only on a user click', async () => {
    const view = render(<input aria-label="编辑器" />);
    const editor = screen.getByLabelText('编辑器');
    editor.focus();
    fireEvent.compositionStart(editor);
    view.rerender(<React.Fragment><input aria-label="编辑器" /><ExternalFileConflictNotice conflict={{ path: 'C:\\notes\\file.md' }} /></React.Fragment>);
    expect(screen.getByRole('status')).toHaveTextContent('自动保存已暂停');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByLabelText('编辑器')).toHaveFocus();
    fireEvent.compositionEnd(editor, { data: '中文' });
    fireEvent.click(screen.getByText('查看并处理'));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByText('稍后处理'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});
