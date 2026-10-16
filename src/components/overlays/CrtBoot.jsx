import { useEffect } from 'react';
import './crt-boot.scss';

// Reveals the actual workspace; this never creates another splash screen.
export default function CrtBoot({ onDone }) {
  useEffect(() => {
    const root = document.querySelector('.app');
    root?.classList.add('workspace-arriving');
    const timer = setTimeout(() => {
      root?.classList.remove('workspace-arriving');
      onDone?.();
    }, 850);
    return () => {
      clearTimeout(timer);
      root?.classList.remove('workspace-arriving');
    };
  }, [onDone]);
  return (
    <div className="workspace-entry" aria-hidden="true">
      <span />
    </div>
  );
}
