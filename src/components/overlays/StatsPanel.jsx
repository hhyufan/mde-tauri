import { useEffect, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Chart } from '@antv/g2';
import useEditorStore from '@store/useEditorStore';
import useFileStore from '@store/useFileStore';
import './stats-panel.scss';

function StatsPanel({ open, onClose }) {
  const { t } = useTranslation();
  const chartRef = useRef(null);
  const chartInstanceRef = useRef(null);
  const tabs = useEditorStore((s) => s.tabs);
  const recentFiles = useFileStore((s) => s.recentFiles);

  const extData = useMemo(() => {
    const allFiles = [...tabs, ...recentFiles];
    const counts = {};
    allFiles.forEach((f) => {
      const ext = (f.ext || f.name?.split('.').pop() || 'other').toLowerCase();
      counts[ext] = (counts[ext] || 0) + 1;
    });
    return Object.entries(counts).map(([ext, count]) => ({ ext: `.${ext}`, count }));
  }, [tabs, recentFiles]);

  const wordData = useMemo(() => {
    return tabs.map((tab) => ({
      name: tab.name,
      words: (tab.content || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean).length,
      chars: (tab.content || '').length,
    }));
  }, [tabs]);

  useEffect(() => {
    if (!open || !chartRef.current || extData.length === 0) return;

    if (chartInstanceRef.current) {
      chartInstanceRef.current.destroy();
    }

    const chart = new Chart({
      container: chartRef.current,
      autoFit: true,
      height: 220,
    });

    chart
      .interval()
      .data(extData)
      .encode('x', 'ext')
      .encode('y', 'count')
      .encode('color', 'ext')
      .style('radiusTopLeft', 6)
      .style('radiusTopRight', 6);

    chart.render();
    chartInstanceRef.current = chart;

    return () => {
      if (chartInstanceRef.current) {
        chartInstanceRef.current.destroy();
        chartInstanceRef.current = null;
      }
    };
  }, [open, extData]);

  if (!open) return null;

  return (
    <div className="stats-overlay" onClick={onClose}>
      <div className="stats-panel" onClick={(e) => e.stopPropagation()}>
        <div className="stats-panel__header">
          <h2>{t('stats.title')}</h2>
          <button className="stats-panel__close" onClick={onClose}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="stats-panel__body">
          <div className="stats-panel__summary">
            <div className="stats-card">
              <span className="stats-card__number">{tabs.length}</span>
              <span className="stats-card__label">{t('stats.openFiles')}</span>
            </div>
            <div className="stats-card">
              <span className="stats-card__number">{recentFiles.length}</span>
              <span className="stats-card__label">{t('stats.recentFiles')}</span>
            </div>
            <div className="stats-card">
              <span className="stats-card__number">
                {wordData.reduce((sum, d) => sum + d.words, 0)}
              </span>
              <span className="stats-card__label">{t('stats.totalWords')}</span>
            </div>
            <div className="stats-card">
              <span className="stats-card__number">
                {wordData.reduce((sum, d) => sum + d.chars, 0).toLocaleString()}
              </span>
              <span className="stats-card__label">{t('stats.totalChars')}</span>
            </div>
          </div>

          <div className="stats-panel__chart-section">
            <h3>{t('stats.fileTypeDist')}</h3>
            {extData.length === 0 ? (
              <p className="stats-panel__empty">{t('stats.noData')}</p>
            ) : (
              <div ref={chartRef} className="stats-panel__chart" />
            )}
          </div>

          {wordData.length > 0 && (
            <div className="stats-panel__table-section">
              <h3>{t('stats.wordCountPerFile')}</h3>
              <table className="stats-panel__table">
                <thead>
                  <tr>
                    <th>{t('stats.file')}</th>
                    <th>{t('stats.words')}</th>
                    <th>{t('stats.chars')}</th>
                  </tr>
                </thead>
                <tbody>
                  {wordData.map((d, i) => (
                    <tr key={i}>
                      <td>{d.name}</td>
                      <td>{d.words}</td>
                      <td>{d.chars.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default StatsPanel;
