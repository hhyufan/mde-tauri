import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, InputNumber } from 'antd';
import { MAX_TABLE_ROWS, MAX_TABLE_COLUMNS, tableDimensions } from './tableDimensions';
import './table-picker.scss';

export default function TablePicker({ onInsert, onClose, initialRows = 3, initialColumns = 3, resize = false }) {
  const { t } = useTranslation();
  const [rows, setRows] = useState(initialRows), [columns, setColumns] = useState(initialColumns);
  const insert = (r, c) => { if (tableDimensions(r, c)) onInsert(r, c); };
  // 网格滑过时行列数也会跟着变；antd 的 InputNumber 清空时给到 null，回落到 1 免得空值。
  const clamp = (value, max) => Math.min(max, Math.max(1, value ?? 1));
  return <div className="ft__table-panel" role="dialog" aria-label={t(resize ? 'table.resize' : 'table.insert')}
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
      <label>{t('table.rows')}
        <InputNumber size="small" aria-label={t('table.rows')} min={1} max={MAX_TABLE_ROWS} value={rows}
          onChange={(value) => setRows(clamp(value, MAX_TABLE_ROWS))} />
      </label>
      <label>{t('table.columns')}
        <InputNumber size="small" aria-label={t('table.columns')} min={1} max={MAX_TABLE_COLUMNS} value={columns}
          onChange={(value) => setColumns(clamp(value, MAX_TABLE_COLUMNS))} />
      </label>
      <Button type="primary" size="small" htmlType="submit">{t(resize ? 'table.resize' : 'table.insert')}</Button>
    </form>
    <p>{t('table.quickHint')}</p>
  </div>;
}
