import * as React from 'react';
import { lazy, Suspense, useState } from 'react';
import { Tooltip } from 'antd';
import i18n from '@/i18n';

const ExternalFileConflictModal = lazy(() => import('./ExternalFileConflictModal'));

export default function ExternalFileConflictNotice({ conflict, onKeep, onUseDisk, onSaveAs }) {
  const [reviewOpen, setReviewOpen] = useState(false);
  return (
    <React.Fragment>
      <div className="external-file-notice" role="status">
        <Tooltip title={conflict.path} placement="top" mouseEnterDelay={0.3}>
          <span>
            {conflict.kind === 'removed' ? i18n.t('sync.conflict.noticeRemoved') : i18n.t('sync.conflict.noticeChanged')}
            {' · '}{conflict.path.split(/[\\/]/).pop()}
          </span>
        </Tooltip>
        <button type="button" onClick={() => setReviewOpen(true)}>{i18n.t('sync.conflict.review')}</button>
      </div>
      {reviewOpen && (
        <Suspense fallback={null}>
          <ExternalFileConflictModal
            conflict={conflict}
            onKeep={onKeep}
            onUseDisk={onUseDisk}
            onSaveAs={onSaveAs}
            onClose={() => setReviewOpen(false)}
          />
        </Suspense>
      )}
    </React.Fragment>
  );
}
