import { useEffect, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open } from '@tauri-apps/plugin-dialog';
import appIcon from '../../src-tauri/icons/32x32.png';
import './installer.css';

const scenes = [
  {
    label: 'WRITE',
    title: (
      <>
        落笔即所见，
        <br />
        <em>专注每个想法。</em>
      </>
    ),
    description: (
      <>
        Markdown 源码与实时预览并肩呈现。
        <br />
        从第一行文字，到完整的创作。
      </>
    ),
    tags: ['Markdown', '实时预览', '所见即所得'],
    proof: '书写与预览，始终同步',
  },
  {
    label: 'PERSONALIZE',
    title: (
      <>
        白昼或深夜，
        <br />
        <em>都恰好合心意。</em>
      </>
    ),
    description: (
      <>
        浅深主题、背景与编辑布局，
        <br />
        让写作空间成为你喜欢的模样。
      </>
    ),
    tags: ['浅深主题', '自定义背景', '灵活布局'],
    proof: '你的节奏，你的工作区',
  },
  {
    label: 'ORGANIZE',
    title: (
      <>
        让零散灵感，
        <br />
        <em>慢慢连成体系。</em>
      </>
    ),
    description: (
      <>
        用文档树与知识树整理笔记，
        <br />
        让每个想法，都有迹可循。
      </>
    ),
    tags: ['文档树', '知识树', '快速查找'],
    proof: '让知识有序生长',
  },
];
const stages = {
  ready: '准备安装',
  preparing: '准备安装文件',
  runtime: '检查运行环境',
  copying: '写入应用文件',
  registering: '注册应用与文件关联',
  shortcuts: '创建快捷方式',
  complete: '安装完成',
  error: '安装未完成',
};
const phaseOrder = ['preparing', 'copying', 'registering', 'complete'];

function FeatureCard({ slide }) {
  if (slide === 1)
    return (
      <div className="theme-pair">
        <div className="theme-card window">
          <div className="theme-head">☀ &nbsp; LIGHT MODE</div>
          <div className="swatches">
            <i />
            <i />
            <i />
          </div>
          <h3>A fresh page.</h3>
          <div className="theme-line" />
          <div className="theme-line" />
        </div>
        <div className="theme-card dark window">
          <div className="theme-head">☾ &nbsp; DARK MODE</div>
          <div className="swatches">
            <i />
            <i />
            <i />
          </div>
          <h3>Quietly inspired.</h3>
          <div className="theme-line" />
          <div className="theme-line" />
        </div>
      </div>
    );
  if (slide === 2)
    return (
      <div className="tree-card window">
        <div className="bar">
          <i />
          <i />
          <i />
          <span>My knowledge space</span>⋯
        </div>
        <div className="tree-body">
          <div className="files">
            <b>MY WORKSPACE</b>
            <br />⌄ &nbsp;▱ &nbsp; Projects
            <br />
            &nbsp;&nbsp;⌄ &nbsp;▱ &nbsp; Ideas
            <div className="selected">&nbsp;&nbsp;&nbsp;▤ &nbsp; Getting started.md</div>
            &nbsp;&nbsp;▤ &nbsp; Inspiration.md
            <br />
            &nbsp;&nbsp;› &nbsp;▱ &nbsp; Journal
            <br />› &nbsp;▱ &nbsp; Reading notes
          </div>
          <div className="graph">
            <svg viewBox="0 0 330 237">
              <path
                d="M155 57V82H75V111M155 82H235V111M75 131V152H135V173"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.3"
              />
            </svg>
            <div className="node root">✧ &nbsp; My ideas</div>
            <div className="node n1">▤ &nbsp; Writing</div>
            <div className="node n2">▤ &nbsp; Reading</div>
            <div className="node n3">▤ &nbsp; Inspiration</div>
          </div>
        </div>
      </div>
    );
  return (
    <div className="app window">
      <div className="bar">
        <i />
        <i />
        <i />
        <span>my-first-idea.md</span>⋯
      </div>
      <div className="editor">
        <div className="rail">
          <b>▤</b>⌕<br />⌘<br />⚙
        </div>
        <div className="source">
          {[
            '# A little space for ideas',
            '',
            'Let your thoughts take shape.',
            '',
            '## Make something meaningful',
            '',
            '> One line at a time.',
            '',
            '- [x] Start with a small idea',
          ].map((line, index) => (
            <div key={index}>
              <span className="line">{index + 1}</span>
              <span className={line.startsWith('#') ? 'code-heading' : ''}>{line || ' '}</span>
            </div>
          ))}
        </div>
        <div className="preview">
          <h2>
            A little space
            <br />
            for ideas.
          </h2>
          <p>Let your thoughts take shape.</p>
          <blockquote>One line at a time.</blockquote>
          <div className="rule" />
          <div className="rule short" />
          <p>☑ Start with a small idea</p>
          <span className="caret" />
        </div>
      </div>
    </div>
  );
}

export default function Installer() {
  const native = isTauri();
  const [slide, setSlide] = useState(0);
  const [directory, setDirectory] = useState('');
  const [status, setStatus] = useState({ stage: 'ready', percent: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmClose, setConfirmClose] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [demoRunning, setDemoRunning] = useState(false);
  const done = status.stage === 'complete';
  useEffect(() => {
    if (!native) {
      setDirectory('C:\\Users\\you\\AppData\\Local\\MokiDown');
      return;
    }
    invoke('default_install_directory')
      .then(setDirectory)
      .catch((e) => setError(String(e)));
    let disposed = false,
      unlisten;
    listen('install-progress', ({ payload }) => {
      if (!disposed) setStatus(payload);
    }).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [native]);
  useEffect(() => {
    const timer = setInterval(() => setSlide((s) => (s + 1) % 3), 7200);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!demoRunning) return;
    const events = [
      { stage: 'preparing', percent: 5 },
      { stage: 'runtime', percent: 12 },
      { stage: 'copying', percent: 25 },
      { stage: 'copying', percent: 57 },
      { stage: 'registering', percent: 78 },
      { stage: 'shortcuts', percent: 94 },
      { stage: 'complete', percent: 100 },
    ];
    const timers = events.map((event, index) =>
      setTimeout(() => {
        setStatus(event);
        if (event.stage === 'complete') {
          setBusy(false);
          setDemoRunning(false);
        }
      }, index * 1400),
    );
    return () => timers.forEach(clearTimeout);
  }, [demoRunning]);
  async function chooseDirectory() {
    if (busy) return;
    if (!native) {
      setShowNotes(true);
      return;
    }
    try {
      const path = await open({ directory: true, multiple: false, title: '选择安装位置' });
      if (path) setDirectory(path);
    } catch (e) {
      setError(String(e));
    }
  }
  async function install() {
    if (busy) return;
    setError('');
    setBusy(true);
    setStatus({ stage: 'preparing', percent: 0 });
    if (!native) {
      setDemoRunning(true);
      return;
    }
    try {
      await invoke('install_application', { directory });
      setStatus({ stage: 'complete', percent: 100 });
    } catch (e) {
      setError(String(e));
      setStatus((s) => ({ ...s, stage: 'error' }));
    } finally {
      setBusy(false);
    }
  }
  async function launch() {
    try {
      await invoke('launch_application');
      await getCurrentWindow().close();
    } catch (e) {
      setError(String(e));
    }
  }
  function close() {
    if (busy) {
      setConfirmClose(true);
      return;
    }
    if (native) void getCurrentWindow().close();
    else setShowNotes(true);
  }
  const currentPhase = done
    ? 3
    : status.stage === 'registering' || status.stage === 'shortcuts'
      ? 2
      : status.stage === 'copying'
        ? 1
        : 0;
  return (
    <main className={`installer ${busy ? 'is-installing' : ''} ${done ? 'is-done' : ''}`}>
      <div className="titlebar" data-tauri-drag-region>
        <div className="brand" data-tauri-drag-region>
          <img src={appIcon} alt="" />
          MokiDown<span>INSTALLER</span>
        </div>
        <div className="window-actions">
          <button aria-label="最小化" onClick={() => native && getCurrentWindow().minimize()}>
            −
          </button>
          <button aria-label="关闭安装器" onClick={close}>
            ×
          </button>
        </div>
      </div>
      <section className="feature" aria-label="MokiDown 功能介绍">
        <div key={`copy-${slide}`} className="copy">
          <div className="eyebrow">
            0{slide + 1} / {scenes[slide].label}
          </div>
          <h1>
            {done ? (
              <>
                一切已就绪，
                <br />
                <em>开始新的创作。</em>
              </>
            ) : (
              scenes[slide].title
            )}
          </h1>
          <p className="description">
            {done
              ? '你的写作空间已经准备好了。让 Moki 陪你记录下一个想法。'
              : scenes[slide].description}
          </p>
          <div className="tags">
            {scenes[slide].tags.map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
          </div>
        </div>
        <div key={`scene-${slide}`} className="stage">
          <div className="card-motion">
            <FeatureCard slide={slide} />
          </div>
          <div className="proof">{scenes[slide].proof}</div>
          <div
            className={`mascot mascot--${slide}`}
            role="img"
            aria-label={
              [
                '浅色 Moki 书写，蓝白运动鞋',
                '深色 Moki 切换主题，深蓝运动鞋',
                '浅色 Moki 整理文件，蓝白系带运动鞋',
              ][slide]
            }
          />
        </div>
        <nav className="dots" aria-label="切换功能介绍">
          {scenes.map((scene, index) => (
            <button
              key={scene.label}
              aria-label={scene.label}
              aria-pressed={slide === index}
              className={`dot ${slide === index ? 'active' : ''}`}
              onClick={() => setSlide(index)}
            />
          ))}
          <span>0{slide + 1} — 03</span>
        </nav>
        <div className="feature-label">A SPACE FOR YOUR IDEAS</div>
      </section>
      <footer className="install-panel">
        {native ? null : <div className="preview-badge">交互设计预览 · 不会安装文件</div>}
        <div className="status-row" role="status">
          <span className="status-dot" />
          <strong>
            {done
              ? '欢迎来到你的新工作区'
              : busy
                ? stages[status.stage]
                : '为下一个灵感，留一个位置。'}
          </strong>
          <span className="percentage">
            {busy || done ? `${Math.round(status.percent)}%` : 'READY WHEN YOU ARE'}
          </span>
        </div>
        <div
          className="progress"
          role="progressbar"
          aria-label="安装阶段进度"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={status.percent}
        >
          <div className="progress-fill" style={{ width: `${status.percent}%` }}>
            <i className="progress-shimmer" />
            {status.percent > 0 && <i className="progress-tip" />}
          </div>
        </div>
        {busy || done ? (
          <div className="phase-row">
            {phaseOrder.map((phase, index) => (
              <span key={phase} className={index <= currentPhase ? 'reached' : ''}>
                <i>{index < currentPhase || done ? '✓' : index + 1}</i>
                {['准备', '安装', '配置', '完成'][index]}
              </span>
            ))}
          </div>
        ) : (
          <div className="path-row">
            <span className="folder-icon">▱</span>
            <label htmlFor="install-path">安装位置</label>
            <input
              id="install-path"
              value={directory}
              onChange={(event) => setDirectory(event.target.value)}
              spellCheck={false}
            />
            <button className="text-button" onClick={chooseDirectory}>
              更改
            </button>
          </div>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="actions">
          <p>
            {done
              ? '写下第一行，让想法慢慢生长。'
              : busy
                ? '正在准备你的写作空间，请保持窗口开启。'
                : '仅为当前用户安装 · 文档始终属于你'}
          </p>
          {done ? (
            <button className="primary" onClick={() => (native ? launch() : setShowNotes(true))}>
              开始使用 <span>↗</span>
            </button>
          ) : (
            <button className="primary" disabled={busy || !directory} onClick={install}>
              {busy ? (
                <>
                  <i className="button-spinner" />
                  正在安装
                </>
              ) : (
                <>
                  {error ? '重新安装' : '开始安装'} <span>→</span>
                </>
              )}
            </button>
          )}
        </div>
      </footer>
      {(confirmClose || showNotes) && (
        <div className="dialog-backdrop">
          <div className="dialog" role="dialog" aria-modal="true">
            <h2>{confirmClose ? '安装正在进行' : '这是交互设计预览'}</h2>
            <p>
              {confirmClose
                ? '为避免留下未完成的安装，请等待当前安装结束。'
                : '正式安装器支持选择目录和静默安装，当前浏览器页面只演示界面与动效。'}
            </p>
            <button
              className="primary"
              onClick={() => {
                setConfirmClose(false);
                setShowNotes(false);
              }}
            >
              知道了
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
