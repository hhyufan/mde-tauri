import { lazy, Suspense } from 'react';
import ReactMarkdown from 'react-markdown';
import LanguageDemo from './LanguageDemo';
import remarkGfm from 'remark-gfm';
import { Tree, ConfigProvider } from 'antd';
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
import { parseTreeText } from '../../src/utils/mgtree';
import '../../src/components/editor/markdown-preview.scss';
import '../../src/components/layout/sidebar/explorer/file-tree.scss';
import '../../src/components/layout/tab-bar/tabbar.scss';
import '../../src/components/layout/sidebar/sidebar.scss';
import '../../src/components/editor/tree-editor.scss';
import './feature-scenes.css';

const WritingDemo = lazy(() => import('./WritingDemo'));

const markdown =
  '# 写下新的想法\n\n从一行文字，开始新的创作。\n\n> 好的想法，值得被认真记录。\n\n- [x] 记录今天的灵感\n- [ ] 写下新的故事';
const lines = markdown.split('\n');
const tree = parseTreeText(
  '我的知识空间\n  写作与灵感\n    每日随笔\n    创作清单\n  阅读与积累\n    阅读笔记\n    收藏的句子',
);

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
        › &nbsp; 本地历史 <span>0</span>
      </div>
    </div>
  );
}

function TreePreview() {
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
        <span className="moki-tree__title">{node.title}</span>
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
            <ApartmentOutlined />7 个节点
          </span>
        </div>
        <div className="moki-tree__canvas">
          <Tree
            treeData={tree.map(toNode)}
            defaultExpandAll
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

export default function FeatureScenes({ slide, active }) {
  if (slide === 1)
    return (
      <div className="feature-scene scene-wysiwyg" aria-label="所见即所得组件展示">
        <div className="scene-surface scene-editor-card">
          <PanelHeader name="灵感随笔.md" />
          <div className="scene-demo-body">
            {active && (
              <Suspense fallback={<div className="scene-demo-loading" />}>
                <WritingDemo />
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
          {active && <LanguageDemo />}
        </div>
      </div>
    );
  if (slide === 3)
    return (
      <div className="feature-scene scene-themes" aria-label="浅深主题组件展示">
        <div className="scene-theme-card">
          <PanelHeader name="开始创作.md" />
          <DocumentPreview compact />
          <div className="scene-theme-footer">
            <span>浅色主题</span>
            <span>UTF-8 · LF</span>
          </div>
        </div>
        <div className="scene-theme-card scene-theme-card--dark" data-theme="dark">
          <PanelHeader name="开始创作.md" />
          <DocumentPreview compact />
          <div className="scene-theme-footer">
            <span>深色主题</span>
            <span>UTF-8 · LF</span>
          </div>
        </div>
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
          <TreePreview />
        </div>
      </div>
    );
  return (
    <div className="feature-scene scene-write" aria-label="源码与 Markdown 预览组件展示">
      <div className="scene-surface scene-editor-card">
        <PanelHeader name="开始创作.md" />
        <div className="scene-editor-split">
          <div className="scene-code" aria-label="Markdown 源码">
            {lines.map((line, i) => (
              <div key={i}>
                <span className="scene-line-number">{i + 1}</span>
                <span
                  className={
                    line.startsWith('#')
                      ? 'scene-token-heading'
                      : line.startsWith('>')
                        ? 'scene-token-quote'
                        : ''
                  }
                >
                  {line || ' '}
                </span>
              </div>
            ))}
          </div>
          <DocumentPreview />
        </div>
        <div className="scene-editor-footer">
          <span>Markdown</span>
          <span>UTF-8 &nbsp; · &nbsp; LF</span>
        </div>
      </div>
    </div>
  );
}
