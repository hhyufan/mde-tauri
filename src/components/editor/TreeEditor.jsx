import { useMemo, useRef, useState } from 'react';
import { Button, Input, Tooltip, Tree } from 'antd';
import {
  ApartmentOutlined, PlusOutlined, ExpandAltOutlined, ShrinkOutlined,
  ZoomInOutlined, ZoomOutOutlined, OneToOneOutlined, FolderOutlined,
  FolderOpenOutlined, FileTextOutlined, CodeOutlined, CloseCircleOutlined,
  VerticalAlignTopOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import useEditorStore from '@store/useEditorStore';
import useConfigStore from '@store/useConfigStore';
import { useEditorBufferContent } from '../../hooks/useEditorBufferContent';
import { getBuffer, setBuffer } from '@utils/editorBuffer';
import { isImeComposing } from '@utils/keyboard';
import { editTreeSource, flattenTree, parseTreeText } from '@utils/mgtree';
import './tree-editor.scss';

function InlineTitle({ title }) {
  return title.split(/(`[^`]+`)/g).map((part, index) => (
    part.startsWith('`') && part.endsWith('`')
      ? <code key={index}>{part.slice(1, -1)}</code> : part
  ));
}

function readExpanded(storageKey) {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    return Array.isArray(saved) ? saved.filter((key) => typeof key === 'string') : [];
  } catch { return []; }
}

export default function TreeEditor({ className = '', onAutoSave, onSourceChange }) {
  const { t } = useTranslation();
  const tabId = useEditorStore((s) => s.activeTabId);
  const tab = useEditorStore((s) => s.tabs.find((item) => item.id === tabId));
  const fontSize = useConfigStore((s) => s.previewFontSize || s.fontSize || 14);
  const source = useEditorBufferContent(tabId, tab?.content || '', 100);
  const nodes = useMemo(() => parseTreeText(source), [source]);
  const flat = useMemo(() => flattenTree(nodes), [nodes]);
  const storageKey = `mde-tree-expanded:${tab?.path || tabId}`;
  const [expanded, setExpanded] = useState(() => readExpanded(storageKey));
  const [editing, setEditing] = useState(null);
  const [value, setValue] = useState('');
  const [zoom, setZoom] = useState(1);
  const [showTop, setShowTop] = useState(false);
  const scrollRef = useRef(null);
  const composingRef = useRef(false);
  const pendingBlurRef = useRef(false);
  const suppressImeEnterRef = useRef(false);
  const cancelledRef = useRef(false);
  const inputValueRef = useRef('');

  const updateExpanded = (keys) => {
    setExpanded(keys);
    try { localStorage.setItem(storageKey, JSON.stringify(keys)); } catch { /* Storage may be unavailable. */ }
  };

  const commit = (operation) => {
    // Reject stale row actions while the source pane has a pending render.
    const current = getBuffer(tabId, tab?.content || '');
    if (current !== source) { setEditing(null); return; }
    const next = editTreeSource(current, operation);
    if (next === current) return;
    if (!onSourceChange?.(next)) setBuffer(tabId, next);
    useEditorStore.getState().markTabDirty(tabId, true);
    useEditorStore.getState().setCharacterCount(next.length);
    onAutoSave?.();
    return next;
  };

  const startEdit = (node) => {
    cancelledRef.current = false;
    pendingBlurRef.current = false;
    suppressImeEnterRef.current = false;
    inputValueRef.current = node.originalText;
    setValue(node.originalText);
    setEditing(node.key);
  };

  const saveEdit = (node) => {
    if (cancelledRef.current || composingRef.current) return;
    const nextValue = inputValueRef.current.trim();
    if (nextValue) commit({ type: 'rename', node, value: nextValue });
    setEditing(null);
  };

  const addNode = (parent) => {
    const next = commit({ type: 'add', node: parent, value: t('tree.newNode') });
    if (next === undefined) return;
    const updated = flattenTree(parseTreeText(next));
    const index = parent ? updated.findIndex((item) => item.lineIndex === parent.lineIndex) : -1;
    const newNode = parent ? flattenTree([updated[index]]).at(-1) : updated.at(-1);
    const addedLine = newNode.lineIndex;
    updateExpanded([...new Set([
      ...expanded.map((key) => {
        const line = Number(key.slice(5));
        return line >= addedLine ? `line-${line + 1}` : key;
      }), ...(parent ? [parent.key] : []),
    ])]);
    startEdit(newNode);
  };

  const deleteNode = (node) => {
    const next = commit({ type: 'delete', node });
    if (next === undefined) return;
    const last = flattenTree([node]).at(-1).lineIndex;
    const count = last - node.lineIndex + 1;
    updateExpanded(expanded.flatMap((key) => {
      const line = Number(key.slice(5));
      if (line >= node.lineIndex && line <= last) return [];
      return [line > last ? `line-${line - count}` : key];
    }));
    setEditing(null);
  };

  const action = (name, icon, onClick, extra = {}) => (
    <Tooltip title={t(`tree.${name}`)}>
      <Button type="text" size="small" aria-label={t(`tree.${name}`)} icon={icon} onClick={onClick} {...extra} />
    </Tooltip>
  );

  const renderNode = (node, index, siblings) => {
    const branch = node.children.length > 0;
    const Icon = branch ? (expanded.includes(node.key) ? FolderOpenOutlined : FolderOutlined)
      : node.jumpLanguage ? CodeOutlined : FileTextOutlined;
    return {
      key: node.key,
      className: index === siblings.length - 1 ? 'mde-tree__last' : '',
      title: (
        <div className={`mde-tree__node ${node.jumpLanguage ? 'mde-tree__node--linked' : ''}`}>
          <Icon className={`mde-tree__icon ${branch ? 'mde-tree__icon--folder' : ''}`} />
          {editing === node.key ? (
            <Input autoFocus className="mde-tree__input" size="small" value={value}
              aria-label={t('tree.editNode')} placeholder={t('tree.inputHint')}
              onFocus={(event) => event.target.select()}
              onChange={(event) => { inputValueRef.current = event.target.value; setValue(event.target.value); }}
              onCompositionStart={() => { composingRef.current = true; }}
              onCompositionEnd={(event) => {
                composingRef.current = false;
                inputValueRef.current = event.currentTarget.value;
                suppressImeEnterRef.current = true;
                setTimeout(() => { suppressImeEnterRef.current = false; }, 0);
                // Clicking an IME candidate can blur the input before the final
                // input event. Commit after composition and that input event land.
                if (pendingBlurRef.current) {
                  pendingBlurRef.current = false;
                  setTimeout(() => saveEdit(node), 0);
                }
              }}
              onBlur={() => {
                if (composingRef.current) pendingBlurRef.current = true;
                else saveEdit(node);
              }}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (isImeComposing(event) || composingRef.current) return;
                if (event.key === 'Enter' && suppressImeEnterRef.current) return;
                if (event.key === 'Enter') { event.preventDefault(); saveEdit(node); }
                if (event.key === 'Escape') { cancelledRef.current = true; setEditing(null); }
              }}
            />
          ) : (
            <button type="button" className="mde-tree__title" onClick={(event) => { event.stopPropagation(); startEdit(node); }}
              title={t('tree.editHint')}>
              <InlineTitle title={node.title || t('tree.newNode')} />
            </button>
          )}
          {node.jumpLanguage && editing !== node.key && (
            <span className="mde-tree__reference" title={node.originalText}>
              {node.jumpLanguage}<span>{node.jumpIndex}</span>
            </span>
          )}
          {editing !== node.key && (
            <span className="mde-tree__actions" onClick={(event) => event.stopPropagation()}>
              {action('addChild', <PlusOutlined />, () => addNode(node))}
              {action('deleteNode', <CloseCircleOutlined />, () => deleteNode(node), { danger: true })}
            </span>
          )}
        </div>
      ),
      children: node.children.map(renderNode),
    };
  };

  return (
    <section className={`mde-tree ${className}`} aria-label={t('tree.title')} style={{ '--tree-font-size': `${fontSize}px` }}>
      <div className="mde-tree__toolbar">
        <div className="mde-tree__tools">
          {action('addRoot', <PlusOutlined />, () => addNode(null), { className: 'mde-tree__add' })}
          {action('expandAll', <ExpandAltOutlined />, () => updateExpanded(flat.filter((node) => node.children.length).map((node) => node.key)))}
          {action('collapseAll', <ShrinkOutlined />, () => updateExpanded([]))}
          <span className="mde-tree__separator" />
          {action('zoomIn', <ZoomInOutlined />, () => setZoom((z) => Math.min(3, z + 0.2)), { disabled: zoom >= 3 })}
          {action('zoomOut', <ZoomOutOutlined />, () => setZoom((z) => Math.max(0.5, z - 0.2)), { disabled: zoom <= 0.5 })}
          {action('resetZoom', <OneToOneOutlined />, () => setZoom(1))}
          <span className="mde-tree__zoom">{Math.round(zoom * 100)}%</span>
        </div>
        <span className="mde-tree__count"><ApartmentOutlined />{t('tree.nodeCount', { count: flat.length })}</span>
      </div>
      <div className="mde-tree__scroll" ref={scrollRef} onScroll={(event) => setShowTop(event.currentTarget.scrollTop > 240)}>
        {nodes.length ? (
          <div className="mde-tree__canvas" style={{ zoom }}>
            <Tree treeData={nodes.map(renderNode)} expandedKeys={expanded} onExpand={updateExpanded}
              blockNode showIcon={false} showLine={{ showLeafIcon: false }}
              switcherIcon={<span className="mde-tree__chevron"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="m6 3 5 5-5 5" /></svg></span>} />
          </div>
        ) : (
          <div className="mde-tree__empty">
            <ApartmentOutlined /><strong>{t('tree.empty')}</strong><p>{t('tree.emptyHint')}</p>
            <Button onClick={() => addNode(null)} icon={<PlusOutlined />}>{t('tree.addRoot')}</Button>
          </div>
        )}
      </div>
      <div className="mde-tree__hint">{t('tree.hint')}</div>
      {showTop && <button className="mde-tree__top" type="button" aria-label={t('tree.backToTop')}
        onClick={() => scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}><VerticalAlignTopOutlined /></button>}
    </section>
  );
}
