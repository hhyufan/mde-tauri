import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, InputNumber } from 'antd';
import { MAX_TABLE_ROWS, MAX_TABLE_COLUMNS, tableDimensions } from './tableDimensions';
import './table-picker.scss';

export default function TablePicker({ onInsert, onClose, initialRows = 3, initialColumns = 3, resize = false }) {
  const { t } = useTranslation();
  const [rows, setRows] = useState(initialRows), [columns, setColumns] = useState(initialColumns);
  const panelRef = useRef(null);
  useEffect(() => {
    const panel = panelRef.current;
    let axis = '', accumulated = 0, lastTime = 0;
    const wheel = (event) => {
      const control = event.target.closest?.('.ant-input-number');
      if (!control?.contains(document.activeElement) || !event.deltaY || event.ctrlKey || event.metaKey || event.altKey) return;
      const nextAxis = control.closest('[data-table-axis]')?.dataset.tableAxis;
      if (!nextAxis) return;
      event.preventDefault();
      event.stopPropagation();
      // A wheel notch changes once; small trackpad events accumulate into a step.
      if (axis !== nextAxis || event.timeStamp - lastTime > 180 || Math.sign(accumulated) !== Math.sign(event.deltaY)) accumulated = 0;
      axis = nextAxis; lastTime = event.timeStamp;
      const delta = event.deltaMode ? event.deltaY * 40 : event.deltaY;
      accumulated += delta;
      if (Math.abs(accumulated) < 40) return;
      accumulated = 0;
      const amount = Math.sign(delta) * (event.shiftKey ? 5 : 1);
      const max = axis === 'rows' ? MAX_TABLE_ROWS : MAX_TABLE_COLUMNS;
      (axis === 'rows' ? setRows : setColumns)((value) => Math.min(max, Math.max(1, (value ?? 1) - amount)));
    };
    panel.addEventListener('wheel', wheel, { passive: false });
    return () => panel.removeEventListener('wheel', wheel);
  }, []);
  const insert = (r, c) => { if (tableDimensions(r, c)) onInsert(r, c); };
  // 网格滑过时行列数也会跟着变；antd 的 InputNumber 清空时给到 null，回落到 1 免得空值。
  const clamp = (value, max) => Math.min(max, Math.max(1, value ?? 1));
  return <div ref={panelRef} className="ft__table-panel" role="dialog" aria-label={t(resize ? 'table.resize' : 'table.insert')}
    onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); onClose(); } }}>
    <div className="ft__table-size">{t('table.size', { rows, columns })}</div>
    <div className="ft__table-grid">
      {Array.from({ length: 36 }, (_, index) => {
        const r = Math.floor(index / 6) + 1, c = index % 6 + 1;
        return <button key={index} type="button" className={r <= rows && c <= columns ? 'is-selected' : ''}
          aria-label={t('table.size', { rows: r, columns: c })}
          onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => { setRows(r); setColumns(c); }}
          onClick={() => insert(r, c)} />;
      })}
    </div>
    <form onSubmit={(event) => { event.preventDefault(); insert(clamp(rows, MAX_TABLE_ROWS), clamp(columns, MAX_TABLE_COLUMNS)); }}>
      <label data-table-axis="rows" title={t('table.wheelHint')}>{t('table.rows')}
        <InputNumber size="small" aria-label={t('table.rows')} min={1} max={MAX_TABLE_ROWS} value={rows}
          changeOnWheel={false}
          onChange={(value) => setRows(clamp(value, MAX_TABLE_ROWS))} />
      </label>
      <label data-table-axis="columns" title={t('table.wheelHint')}>{t('table.columns')}
        <InputNumber size="small" aria-label={t('table.columns')} min={1} max={MAX_TABLE_COLUMNS} value={columns}
          changeOnWheel={false}
          onChange={(value) => setColumns(clamp(value, MAX_TABLE_COLUMNS))} />
      </label>
      <Button type="primary" size="small" htmlType="submit">{t(resize ? 'table.resize' : 'table.insert')}</Button>
    </form>
    <p>{t('table.wheelHint')}</p>
    <p>{t('table.quickHint')}</p>
  </div>;
}
