import * as React from 'react';
import { lazy, Suspense, useState } from 'react';

const ExternalFileConflictModal = lazy(() => import('./ExternalFileConflictModal'));

export default function ExternalFileConflictNotice({ conflict, onKeep, onUseDisk, onSaveAs }) {
  const [reviewOpen, setReviewOpen] = useState(false);
  return (
    <React.Fragment>
      <div className="external-file-notice" role="status">
        <span title={conflict.path}>
          {conflict.kind === 'removed' ? '文件已被删除或移动' : '文件在外部发生变化，自动保存已暂停'}
          {' · '}{conflict.path.split(/[\\/]/).pop()}
        </span>
        <button type="button" onClick={() => setReviewOpen(true)}>查看并处理</button>
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
