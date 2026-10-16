import { MoonOutlined, SunOutlined } from '@ant-design/icons';
import { useEffect, useState } from 'react';
import useDemoComplete from './useDemoComplete';

function ThemeFrame({ dark, children }) {
  return (
    <div className="scene-theme-frame" data-theme={dark ? 'dark' : 'light'}>
      {children}
      <div className="scene-theme-footer">
        <span className="scene-theme-switch" aria-label={dark ? '切换浅色主题' : '切换深色主题'}>
          {dark ? <SunOutlined /> : <MoonOutlined />}
        </span>
        <span>{dark ? '深色主题' : '浅色主题'}</span>
        <span>UTF-8 · LF</span>
      </div>
    </div>
  );
}

export default function ThemeDemo({ children, onComplete }) {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const [dark, setDark] = useState(false);
  const [reveal, setReveal] = useState(null);
  const [finished, setFinished] = useState(reduced);
  useEffect(() => {
    if (reduced) return undefined;
    // 涟漪本身只有 300ms（见 feature-scenes.css），此前两跳之间隔了 3.8s，
    // 体感是"动画太长"。这里把每一跳前的停留压到 1s：
    // 1.0s 起跳深色（+300ms 结束）→ 再停 1s → 2.6s 起跳回浅色。
    const timers = [
      setTimeout(() => setReveal('dark'), 1000),
      setTimeout(() => setReveal('light'), 2600),
    ];
    return () => timers.forEach(clearTimeout);
  }, [reduced]);
  useDemoComplete(finished, onComplete);
  // The app reveals the new theme from its bottom-left toggle using a 300ms circle.
  return (
    <div
      className="scene-surface scene-editor-card scene-theme-demo"
      data-theme-state={reveal ? 'ripple' : dark ? 'dark' : 'light'}
      data-complete={finished}
    >
      <ThemeFrame dark={dark}>{children}</ThemeFrame>
      {reveal && (
        <div
          key={reveal}
          className="scene-theme-ripple"
          aria-hidden="true"
          onAnimationEnd={(event) => {
            // 只认覆盖层自己的动画：animationend 会从子元素冒泡上来，
            // 提前收掉覆盖层就会露出还没换底色的那一帧（白闪）。
            if (event.target !== event.currentTarget) return;
            // 先把底色切过去——此刻覆盖层还在，这一帧看不见；
            // 下一帧再撤覆盖层，避免"覆盖层已移除、底色尚未换"的一帧。
            setDark(reveal === 'dark');
            if (reveal === 'light') setFinished(true);
            requestAnimationFrame(() => setReveal(null));
          }}
        >
          <ThemeFrame dark={reveal === 'dark'}>{children}</ThemeFrame>
        </div>
      )}
    </div>
  );
}
