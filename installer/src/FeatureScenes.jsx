import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import LanguageDemo from './LanguageDemo';
import SplitDemo from './SplitDemo';
import ThemeDemo from './ThemeDemo';
import TreeDemo from './TreeDemo';
import remarkGfm from 'remark-gfm';
import { Tree, ConfigProvider, Input } from 'antd';
import {
  FolderOpenOutlined,
  FileTextOutlined,
  PlusOutlined,
  ExpandAltOutlined,
  ShrinkOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
  ApartmentOutlined,
  OneToOneOutlined,
} from '@ant-design/icons';
import FileIcon from '../../src/components/ui/FileTypeIcon';
import { flattenTree } from '../../src/utils/mgtree';
import '../../src/components/editor/markdown-preview.scss';
import '../../src/components/layout/sidebar/explorer/file-tree.scss';
import '../../src/components/layout/tab-bar/tabbar.scss';
import '../../src/components/layout/sidebar/sidebar.scss';
import '../../src/components/editor/tree-editor.scss';
import './feature-scenes.css';

const WritingDemo = lazy(() => import('./WritingDemo'));

const markdown =
  '# 写下新的想法\n\n从一行文字，开始新的创作。\n\n> 好的想法，值得被认真记录。\n\n- [x] 记录今天的灵感\n- [ ] 写下新的故事';

function DocumentPreview({ compact = false }) {
  return (
    <div className={`md-preview scene-markdown${compact ? ' scene-markdown--compact' : ''}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
    </div>
  );
}

function PanelHeader({ name, extension = 'md' }) {
  return (
    <div className="tabbar scene-tabbar">
      <div className="tabbar__tabs">
        <div className="tabbar__tab tabbar__tab--active">
          <span className="tabbar__tab-icon">
            <FileIcon extension={extension} size={16} />
          </span>
          <span className="tabbar__tab-name">{name}</span>
          <span className="tabbar__tab-close">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="m4 4 8 8M12 4l-8 8" />
            </svg>
          </span>
        </div>
      </div>
      <span className="scene-layout-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M12 3v18" />
        </svg>
      </span>
    </div>
  );
}

function FileList() {
  return (
    <div className="scene-files">
      <div className="sidebar__tabs">
        <div className="sidebar__tab-slider" style={{ width: 'calc((100% - 10px) / 3)' }} />
        <span className="sidebar__tab sidebar__tab--active">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M3 7V5h7l2 2h9v12H3z" />
          </svg>
          文件
        </span>
        <span className="sidebar__tab">大纲</span>
        <span className="sidebar__tab">最近</span>
      </div>
      <div className="sidebar__toolbar">
        <span className="sidebar__toolbar-label">文件</span>
        <span className="stb">
          <PlusOutlined />
        </span>
        <span className="stb">
          <FolderOpenOutlined />
        </span>
      </div>
      <div className="scene-folder">
        <FileIcon isFolder size={16} /> 我的工作区
      </div>
      {['开始创作.md', '灵感笔记.md', '我的知识树.mgtree'].map((name, i) => (
        <div className={`file-tree__item${i === 2 ? ' file-tree__item--active' : ''}`} key={name}>
          <span className="file-tree__item-icon">
            <FileIcon fileName={name} size={16} />
          </span>
          <span className="file-tree__item-name">{name}</span>
        </div>
      ))}
      <div className="scene-history">
        <svg
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <path d="m6 3 5 5-5 5" />
        </svg>
        本地历史 <span className="scene-history-count">0</span>
      </div>
    </div>
  );
}

function TreePreview({ nodes, editing }) {
  const toNode = (node, index, siblings) => ({
    key: node.key,
    className: index === siblings.length - 1 ? 'moki-tree__last' : '',
    title: (
      <div className="moki-tree__node">
        {node.children.length ? (
          <FolderOpenOutlined className="moki-tree__icon moki-tree__icon--folder" />
        ) : (
          <FileTextOutlined className="moki-tree__icon" />
        )}
        {editing?.key === node.key ? (
          <span
            className="scene-tree-input-wrap"
            style={{ '--scene-input-length': editing.value.length }}
          >
            <Input
              className="moki-tree__input"
              size="small"
              value={editing.value}
              readOnly
              tabIndex={-1}
              aria-label="新节点名称"
            />
            <span className="scene-typing-caret" aria-hidden="true" />
          </span>
        ) : (
          <span className="moki-tree__title">{node.title}</span>
        )}
      </div>
    ),
    children: node.children.map(toNode),
  });
  return (
    <ConfigProvider
      theme={{
        token: {
          fontFamily: 'var(--font-app)',
          colorPrimary: '#4091ff',
          colorText: '#2c2c2e',
          fontSize: 14,
        },
      }}
    >
      <section className="moki-tree" style={{ '--tree-font-size': '14px' }}>
        <div className="moki-tree__toolbar">
          <div className="moki-tree__tools">
            <span className="ant-btn moki-tree__add">
              <PlusOutlined />
            </span>
            {[
              ExpandAltOutlined,
              ShrinkOutlined,
              ZoomInOutlined,
              ZoomOutOutlined,
              OneToOneOutlined,
            ].map((Icon, i) => (
              <span className="ant-btn" key={i}>
                <Icon />
              </span>
            ))}
            <span className="moki-tree__zoom">100%</span>
          </div>
          <span className="moki-tree__count">
            <ApartmentOutlined />
            {flattenTree(nodes).length} 个节点
          </span>
        </div>
        <div className="moki-tree__canvas">
          <Tree
            treeData={nodes.map(toNode)}
            expandedKeys={flattenTree(nodes).map((node) => node.key)}
            selectedKeys={editing ? [editing.key] : []}
            motion={null}
            showLine={{ showLeafIcon: false }}
            blockNode
            selectable={false}
            switcherIcon={
              <span className="moki-tree__chevron">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="m6 3 5 5-5 5" />
                </svg>
              </span>
            }
          />
        </div>
        <div className="moki-tree__hint">双击文字可编辑 · Enter 确认 · Esc 取消</div>
      </section>
    </ConfigProvider>
  );
}

export default function FeatureScenes({ slide, active, onComplete }) {
  const [retained, setRetained] = useState(active);
  const activeRef = useRef(active);
  activeRef.current = active;
  const present = active || retained;
  useEffect(() => {
    if (active) {
      setRetained(true);
      return undefined;
    }
    const timer = setTimeout(() => setRetained(false), 480);
    return () => clearTimeout(timer);
  }, [active]);
  const complete = useCallback(() => {
    if (activeRef.current) onComplete?.(slide);
  }, [slide, onComplete]);
  if (slide === 0)
    return (
      <div className="feature-scene scene-wysiwyg" aria-label="所见即所得组件展示">
        <div className="scene-surface scene-editor-card">
          <PanelHeader name="灵感随笔.md" />
          <div className="scene-demo-body">
            {present && (
              <Suspense fallback={<div className="scene-demo-loading" />}>
                <WritingDemo onComplete={complete} />
              </Suspense>
            )}
          </div>
          <div className="scene-editor-footer">
            <span>所见即所得</span>
            <span>Markdown</span>
          </div>
        </div>
      </div>
    );
  if (slide === 2)
    return (
      <div className="feature-scene scene-language" aria-label="Markdown 语言服务组件展示">
        <div className="scene-surface scene-editor-card">
          <PanelHeader name="阅读清单.md" />
          {present && <LanguageDemo onComplete={complete} />}
        </div>
      </div>
    );
  if (slide === 3)
    return (
      <div className="feature-scene scene-themes" aria-label="浅深主题组件展示">
        {present && (
          <ThemeDemo onComplete={complete}>
            <PanelHeader name="开始创作.md" />
            <DocumentPreview compact />
          </ThemeDemo>
        )}
      </div>
    );
  if (slide === 4)
    return (
      <div className="feature-scene scene-organize" aria-label="文件列表与知识树组件展示">
        <div className="scene-surface scene-files-card">
          <FileList />
        </div>
        <div className="scene-surface scene-tree-card">
          <PanelHeader name="我的知识树.mgtree" extension="mgtree" />
          {present && (
            <TreeDemo onComplete={complete}>
              {(nodes, editing) => <TreePreview nodes={nodes} editing={editing} />}
            </TreeDemo>
          )}
        </div>
      </div>
    );
  return (
    <div className="feature-scene scene-write" aria-label="源码与 Markdown 预览组件展示">
      <div className="scene-surface scene-editor-card">
        <PanelHeader name="开始创作.md" />
        {present && <SplitDemo onComplete={complete} />}
        <div className="scene-editor-footer">
          <span>Markdown</span>
          <span>UTF-8 &nbsp; · &nbsp; LF</span>
        </div>
      </div>
    </div>
  );
}
