import { useEffect, useRef, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open } from '@tauri-apps/plugin-dialog';
import wordmark from '../../src/assets/mokidown-wordmark.webp';
import FeatureScenes from './FeatureScenes';
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
  },
  {
    label: 'WYSIWYG',
    title: (
      <>
        写下这一刻，
        <br />
        <em>即刻成为好文章。</em>
      </>
    ),
    description: (
      <>
        输入 Markdown，文字自然成形。
        <br />
        标题、强调与引用，就在笔下呈现。
      </>
    ),
  },
  {
    label: 'LANGUAGE',
    title: (
      <>
        写作的细节，
        <br />
        <em>也有贴心的帮手。</em>
      </>
    ),
    description: (
      <>
        Markdown 语言服务，辅助链接补全与检查。
        <br />
        让文档之间的连接，更顺畅。
      </>
    ),
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

export default function Installer() {
  const native = isTauri();
  const [slide, setSlide] = useState(0);
  const [directory, setDirectory] = useState('');
  // 被更新器拉起来时（命令行带 /UPDATE）走更新流程：目录由注册表决定，用户不能改。
  const [update, setUpdate] = useState(false);
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
    invoke('startup_info')
      .then((info) => {
        setDirectory(info.directory);
        setUpdate(Boolean(info.update));
      })
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
    const timer = setTimeout(
      () => setSlide((s) => (s + 1) % scenes.length),
      slide === 1 ? 14000 : 7200,
    );
    return () => clearTimeout(timer);
  }, [slide]);
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
      // 更新流程装完直接把应用拉起来，并告诉它「刚更新过」——主程序据此跳过
      // 原生启动动画，改播工作区入场动画。
      await invoke('launch_application', { afterUpdate: update });
      await getCurrentWindow().close();
    } catch (e) {
      setError(String(e));
    }
  }
  /*
   * 更新流程全自动：不设按钮，进入即开始安装，装完自动拉起应用并关掉本窗口。
   * 首次安装只保留开始按钮；首次安装和更新完成后都自动进入软件。
   */
  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (!update || !native || autoStartedRef.current) return;
    if (!directory || busy || done || error) return;
    autoStartedRef.current = true;
    void install();
    // install/launch 是每次渲染重建的普通函数，这里只以状态为触发条件
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [update, native, directory, busy, done, error]);
  useEffect(() => {
    if (!native || !done || error) return undefined;
    // 稍留一拍让完成态画出来，再交棒给应用
    const timer = setTimeout(() => {
      void launch();
    }, 900);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [native, done, error]);
  function close() {
    if (busy) {
      setConfirmClose(true);
      return;
    }
    if (native) void getCurrentWindow().close();
    else setShowNotes(true);
  }
  return (
    <main className={`installer ${busy ? 'is-installing' : ''} ${done ? 'is-done' : ''}`}>
      <div className="titlebar" data-tauri-drag-region>
        <div className="brand" data-tauri-drag-region>
          <img className="brand-wordmark" src={wordmark} alt="MokiDown" />
          <span>INSTALLER</span>
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
        </div>
        <div className="stage">
          {scenes.map((scene, index) => (
            <div
              key={scene.label}
              className={`card-motion${slide === index ? ' is-visible' : ''}`}
              aria-hidden={slide !== index}
            >
              <FeatureScenes slide={index} active={slide === index} />
            </div>
          ))}
          <div
            className={`mascot mascot--${[0, 3, 4, 1, 2][slide]}`}
            role="img"
            aria-label={
              [
                '浅色 Moki 书写，蓝白运动鞋',
                '浅色 Moki 演示所见即所得，蓝白运动鞋',
                '浅色 Moki 检查语言服务，蓝白运动鞋',
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
            >
              <i aria-hidden="true" />
            </button>
          ))}
        </nav>
      </section>
      <footer className="install-panel">
        {native ? null : <div className="preview-badge">交互设计预览 · 不会安装文件</div>}
        <div className="status-row" role="status">
          <span className="status-dot" />
          <strong>
            {done
              ? update
                ? '更新完成，欢迎回来'
                : '欢迎来到你的新工作区'
              : busy
                ? stages[status.stage]
                : update
                  ? '准备更新 MokiDown'
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
        {/* 路径行只在还没开始安装时出现。安装中/完成后的进度由上面的状态行与进度条
            表达，不再额外摆一条「准备/安装/配置/完成」——完成页上它是纯噪音。 */}
        {!busy && !done && (
          <div className="path-row">
            <svg
              className="folder-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              aria-hidden="true"
            >
              <path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            </svg>
            <label htmlFor="install-path">{update ? '更新位置' : '安装位置'}</label>
            <input
              id="install-path"
              value={directory}
              readOnly={update}
              onChange={(event) => setDirectory(event.target.value)}
              spellCheck={false}
            />
            {/* 更新时目录来自注册表里上次的安装位置，不让改——改了会装出第二份 */}
            {update ? null : (
              <button className="text-button" onClick={chooseDirectory}>
                <span>更改</span>
                <svg
                  viewBox="0 0 20 20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="m7.5 5 5 5-5 5" />
                </svg>
              </button>
            )}
          </div>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="actions">
          {(done || busy || update) && (
            <p>
              {done
                ? update
                  ? '更新完成，正在启动 MokiDown…'
                  : '安装完成，正在启动 MokiDown…'
                : busy
                  ? update
                    ? '正在更新，请保持窗口开启。'
                    : '正在准备你的写作空间，请保持窗口开启。'
                  : update
                    ? '将保留你的设置、文档与快捷方式'
                    : ''}
            </p>
          )}
          {error ? (
            <button className="primary" onClick={install}>
              重试安装
            </button>
          ) : (
            !update &&
            !done && (
              <button className="primary" disabled={busy || !directory} onClick={install}>
                {busy ? (
                  <>
                    <i className="button-spinner" />
                    正在安装
                  </>
                ) : (
                  '开始安装'
                )}
              </button>
            )
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
