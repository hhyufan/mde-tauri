import { useEffect, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Table, Empty } from 'antd';
import { Chart } from '@antv/g2';
import useEditorStore from '@store/useEditorStore';
import useAuthStore from '@store/useAuthStore';
import useFileStore, { getScopedRecentFiles } from '@store/useFileStore';
import { GUEST_USER_SCOPE } from '@store/userScope';
import './stats-panel.scss';

function StatsPanel({ open, onClose }) {
  const { t } = useTranslation();
  const chartRef = useRef(null);
  const chartInstanceRef = useRef(null);
  const tabs = useEditorStore((s) => s.tabs);
  const userId = useAuthStore((s) => s.user?.id || GUEST_USER_SCOPE);
  const recentEntries = useFileStore((s) => s.recentFiles);
  const recentFiles = useMemo(
    () => getScopedRecentFiles(recentEntries, userId),
    [recentEntries, userId],
  );

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
      key: tab.id,
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

  const columns = [
    { title: t('stats.file'), dataIndex: 'name', key: 'name', ellipsis: true },
    { title: t('stats.words'), dataIndex: 'words', key: 'words', align: 'right', width: 100 },
    {
      title: t('stats.chars'),
      dataIndex: 'chars',
      key: 'chars',
      align: 'right',
      width: 120,
      render: (v) => v.toLocaleString(),
    },
  ];

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={t('stats.title')}
      footer={null}
      width={680}
      centered
      destroyOnHidden
      maskClosable
      rootClassName="mde-stats-modal-root"
    >
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
            <Empty description={t('stats.noData')} />
          ) : (
            <div ref={chartRef} className="stats-panel__chart" />
          )}
        </div>

        {wordData.length > 0 && (
          <div className="stats-panel__table-section">
            <h3>{t('stats.wordCountPerFile')}</h3>
            <Table
              columns={columns}
              dataSource={wordData}
              size="small"
              pagination={false}
              scroll={{ y: 240 }}
            />
          </div>
        )}
      </div>
    </Modal>
  );
}

export default StatsPanel;
