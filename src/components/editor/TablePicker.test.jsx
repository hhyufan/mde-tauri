import * as React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import TablePicker from './TablePicker';

globalThis.React = React;
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key) => key }),
  // @/i18n 初始化时要用它。缺了它，只要有依赖链把 @/i18n 拉进来
  // （测试 → useEditorStore → untitledFileName → @/i18n）就会整体报错。
  initReactI18next: { type: '3rdParty', init: () => {} },
}));
afterEach(cleanup);
function setup(props = {}) {
  const onInsert = vi.fn();
  render(<TablePicker onInsert={onInsert} onClose={() => {}} {...props} />);
  return { rows: screen.getByRole('spinbutton', { name: 'table.rows' }), columns: screen.getByRole('spinbutton', { name: 'table.columns' }), onInsert };
}
function wheel(input, deltaY, options = {}) {
  const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY, ...options });
  act(() => input.dispatchEvent(event));
  return event;
}

it('does not change an unfocused field or capture ordinary scrolling', () => {
  const { rows, columns } = setup();
  expect(wheel(rows, -100).defaultPrevented).toBe(false);
  expect(rows).toHaveValue('3');
  act(() => rows.focus());
  expect(wheel(columns, -100).defaultPrevented).toBe(false);
  expect(columns).toHaveValue('3');
});

it('adjusts the focused field by one, or five with Shift, and keeps changes pending', () => {
  const { rows, columns, onInsert } = setup();
  act(() => rows.focus());
  expect(wheel(rows, -100).defaultPrevented).toBe(true);
  expect(rows).toHaveValue('4');
  wheel(rows, -100, { shiftKey: true });
  expect(rows).toHaveValue('9');
  wheel(rows, 100);
  expect(rows).toHaveValue('8');
  expect(columns).toHaveValue('3');
  expect(onInsert).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'table.insert' }));
  expect(onInsert).toHaveBeenCalledWith(8, 3);
});

it('clamps both dimensions to their supported range', () => {
  const { rows, columns } = setup({ initialRows: 100, initialColumns: 1 });
  act(() => rows.focus());
  wheel(rows, -100, { shiftKey: true });
  expect(rows).toHaveValue('100');
  act(() => columns.focus());
  wheel(columns, 100, { shiftKey: true });
  expect(columns).toHaveValue('1');
});

it('accumulates small trackpad movements instead of changing once per tiny event', () => {
  const { rows } = setup();
  act(() => rows.focus());
  for (let i = 0; i < 3; i++) wheel(rows, -10);
  expect(rows).toHaveValue('3');
  wheel(rows, -10);
  expect(rows).toHaveValue('4');
});

it('preserves browser zoom and horizontal scrolling gestures', () => {
  const { rows } = setup();
  act(() => rows.focus());
  expect(wheel(rows, -100, { ctrlKey: true }).defaultPrevented).toBe(false);
  expect(wheel(rows, -100, { metaKey: true }).defaultPrevented).toBe(false);
  expect(wheel(rows, 0, { deltaX: 100 }).defaultPrevented).toBe(false);
  expect(rows).toHaveValue('3');
});
