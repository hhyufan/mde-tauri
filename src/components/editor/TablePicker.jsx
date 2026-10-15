import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MAX_TABLE_ROWS, MAX_TABLE_COLUMNS, tableDimensions } from './tableDimensions';
import './table-picker.scss';

export default function TablePicker({ onInsert, onClose, initialRows = 3, initialColumns = 3, resize = false }) {
  const { t } = useTranslation();
  const [rows, setRows] = useState(initialRows), [columns, setColumns] = useState(initialColumns);
  const insert = (r, c) => { if (tableDimensions(r, c)) onInsert(r, c); };
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
    <form onSubmit={(event) => { event.preventDefault(); insert(Number(rows), Number(columns)); }}>
      <label>{t('table.rows')}<input aria-label={t('table.rows')} type="number" min="1" max={MAX_TABLE_ROWS} required value={rows} onChange={(e) => setRows(e.target.value)} /></label>
      <label>{t('table.columns')}<input aria-label={t('table.columns')} type="number" min="1" max={MAX_TABLE_COLUMNS} required value={columns} onChange={(e) => setColumns(e.target.value)} /></label>
      <button type="submit">{t(resize ? 'table.resize' : 'table.insert')}</button>
    </form>
    <p>{t('table.quickHint')}</p>
  </div>;
}
