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
