import { useState, useCallback } from 'react';
import { Tooltip } from 'antd';
import useEditorStore from '@store/useEditorStore';
import { cn } from '@utils/classNames';
import './floating-toolbar.scss';

const HEADING_OPTIONS = [
  { label: 'H1', prefix: '# ' },
  { label: 'H2', prefix: '## ' },
  { label: 'H3', prefix: '### ' },
  { label: 'H4', prefix: '#### ' },
  { label: 'H5', prefix: '##### ' },
  { label: 'H6', prefix: '###### ' },
];

function FtBtn({ title, className, onClick, children }) {
  return (
    <Tooltip title={title} placement="top" mouseEnterDelay={0.3}>
      <button className={className} onClick={onClick} type="button">
        {children}
      </button>
    </Tooltip>
  );
}

function FloatingToolbar({ onInsert }) {
  const visible = useEditorStore((s) => s.toolbarVisible);
  const toggleToolbar = useEditorStore((s) => s.toggleToolbar);
  const [headingOpen, setHeadingOpen] = useState(false);

  const wrap = useCallback((before, after) => {
    onInsert?.({ type: 'wrap', before, after: after ?? before });
    setHeadingOpen(false);
  }, [onInsert]);

  const insertBlock = useCallback((text) => {
    onInsert?.({ type: 'insert', text });
    setHeadingOpen(false);
  }, [onInsert]);

  return (
    <>
      <div className={cn('ft', visible && 'ft--show')}>
        <div className="ft__grip">
          <svg viewBox="0 0 16 24" width="10" height="16">
            <circle cx="5" cy="6" r="1.5" fill="currentColor" />
            <circle cx="11" cy="6" r="1.5" fill="currentColor" />
            <circle cx="5" cy="12" r="1.5" fill="currentColor" />
            <circle cx="11" cy="12" r="1.5" fill="currentColor" />
            <circle cx="5" cy="18" r="1.5" fill="currentColor" />
            <circle cx="11" cy="18" r="1.5" fill="currentColor" />
          </svg>
        </div>
        <span className="ft__sep" />

        <FtBtn title="Bold" className="ft__btn ft__btn--active" onClick={() => wrap('**')}><b>B</b></FtBtn>
        <FtBtn title="Italic" className="ft__btn" onClick={() => wrap('*')}><i>I</i></FtBtn>
        <FtBtn title="Strikethrough" className="ft__btn" onClick={() => wrap('~~')}><s>S</s></FtBtn>
        <span className="ft__sep" />

        <div className="ft__heading-group">
          <FtBtn title="Heading" className="ft__btn" onClick={() => setHeadingOpen(!headingOpen)}><b>H</b></FtBtn>
          {headingOpen && (
            <div className="ft__heading-panel">
              {HEADING_OPTIONS.map((h) => (
                <button key={h.label} className="ft__heading-opt" onClick={() => insertBlock(h.prefix)}>
                  {h.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <FtBtn title="Blockquote" className="ft__btn" onClick={() => insertBlock('> ')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="16" height="16">
            <path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V21z" />
            <path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 .001 0 1.003 1 1.003z" />
          </svg>
        </FtBtn>
        <FtBtn title="Table" className="ft__btn" onClick={() => insertBlock('| Col1 | Col2 | Col3 |\n| --- | --- | --- |\n| | | |\n')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="16" height="16">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <line x1="3" y1="9" x2="21" y2="9" /><line x1="3" y1="15" x2="21" y2="15" />
            <line x1="9" y1="3" x2="9" y2="21" /><line x1="15" y1="3" x2="15" y2="21" />
          </svg>
        </FtBtn>
        <FtBtn title="Code block" className="ft__btn" onClick={() => insertBlock('```\n\n```\n')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="16" height="16">
            <polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />
          </svg>
        </FtBtn>
        <span className="ft__sep" />
        <FtBtn title="Link" className="ft__btn" onClick={() => wrap('[', '](url)')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="16" height="16">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
          </svg>
        </FtBtn>
        <FtBtn title="Image" className="ft__btn" onClick={() => insertBlock('![alt](url)\n')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="16" height="16">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <polyline points="21 15 16 10 5 21" />
          </svg>
        </FtBtn>
        <FtBtn title="Task list" className="ft__btn" onClick={() => insertBlock('- [ ] ')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="16" height="16">
            <path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
          </svg>
        </FtBtn>
        <FtBtn title="Horizontal rule" className="ft__btn" onClick={() => insertBlock('---\n')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="16" height="16">
            <line x1="2" y1="12" x2="22" y2="12" />
          </svg>
        </FtBtn>

        <FtBtn
          title="Collapse toolbar"
          className="ft__btn ft__btn--collapse"
          onClick={() => { toggleToolbar(); setHeadingOpen(false); }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="16" height="16">
            <polyline points="4 14 10 14 10 20" /><polyline points="20 10 14 10 14 4" />
            <line x1="14" y1="10" x2="21" y2="3" /><line x1="3" y1="21" x2="10" y2="14" />
          </svg>
        </FtBtn>
      </div>
    </>
  );
}

export default FloatingToolbar;
