import * as React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import TaskStatusIndicator from './TaskStatusIndicator';

globalThis.React = React;
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key) => key }) }));
afterEach(cleanup);

it('keeps the current task visible in the status bar and reopens its collapsed panel', () => {
  const onClick = vi.fn();
  const { rerender } = render(<TaskStatusIndicator stage="downloading" expanded={false} onClick={onClick} />);
  const button = screen.getByRole('button', { name: 'tasks.downloading' });
  expect(button).toHaveAttribute('aria-expanded', 'false');
  expect(button.querySelector('.task-status-indicator__spinner')).toBeInTheDocument();
  fireEvent.click(button);
  expect(onClick).toHaveBeenCalledOnce();
  rerender(<TaskStatusIndicator stage="installing" expanded onClick={onClick} />);
  expect(screen.getByRole('button', { name: 'tasks.installing' })).toHaveAttribute('aria-expanded', 'true');
  rerender(<TaskStatusIndicator stage="error" expanded onClick={onClick} />);
  expect(screen.getByRole('button', { name: 'tasks.title' })).toBeVisible();
  expect(document.querySelector('.task-status-indicator__spinner')).not.toBeInTheDocument();
});

it('检测更新时显示"正在检测更新"，而不是回退到通用标题', () => {
  render(<TaskStatusIndicator stage="checking" expanded={false} onClick={() => {}} />);
  const button = screen.getByRole('button', { name: 'tasks.checking' });
  expect(button).toBeVisible();
  expect(button.querySelector('.task-status-indicator__spinner')).toBeInTheDocument();
});
