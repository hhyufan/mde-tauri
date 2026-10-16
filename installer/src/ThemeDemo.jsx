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
    const timers = [
      setTimeout(() => setReveal('dark'), 1300),
      setTimeout(() => setReveal('light'), 5100),
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
          onAnimationEnd={() => {
            setDark(reveal === 'dark');
            setReveal(null);
            if (reveal === 'light') setFinished(true);
          }}
        >
          <ThemeFrame dark={reveal === 'dark'}>{children}</ThemeFrame>
        </div>
      )}
    </div>
  );
}
