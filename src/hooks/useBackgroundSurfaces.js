import { useLayoutEffect } from 'react';

const POPUPS = '.footer__dropdown, .search-dropdown__panel, .ant-select-dropdown, .ant-dropdown-menu, .ant-picker-panel-container, .ft, .ft__heading-panel, .monaco-context-menu';
const POSITIONERS = `${POPUPS}, .ant-dropdown, .ant-picker-dropdown`;

// Portal popups need the same image, cover dimensions and viewport coordinates
// as the workspace. Explicit coordinates also work inside transformed antd
// containers, where background-attachment: fixed uses a different origin.
export function useBackgroundSurfaces({ enabled, imageUrl, opacity }) {
  useLayoutEffect(() => {
    if (!enabled || !imageUrl) return undefined;
    const root = document.documentElement;
    const popups = new Set();
    const image = new Image();
    const set = (el, name, value) => {
      if (el.style.getPropertyValue(name) !== value) el.style.setProperty(name, value);
    };
    set(root, '--moki-background-image', `url(${JSON.stringify(imageUrl)})`);
    const sync = () => {
      const app = document.querySelector('.app');
      if (!app) return;
      const rect = app.getBoundingClientRect();
      if (image.naturalWidth && image.naturalHeight) {
        const scale = Math.max(rect.width / image.naturalWidth, rect.height / image.naturalHeight);
        const width = image.naturalWidth * scale, height = image.naturalHeight * scale;
        set(root, '--moki-background-size', `${width}px ${height}px`);
        set(root, '--moki-background-x', `${rect.left + (rect.width - width) / 2}px`);
        set(root, '--moki-background-y', `${rect.top + (rect.height - height) / 2}px`);
      }
      for (const popup of popups) {
        if (!popup.isConnected) { popups.delete(popup); resize.unobserve(popup); continue; }
        const box = popup.getBoundingClientRect();
        set(popup, '--moki-popup-x', `${box.left}px`);
        set(popup, '--moki-popup-y', `${box.top}px`);
      }
    };
    const resize = new ResizeObserver(sync);
    const discover = (node) => {
      if (!(node instanceof Element)) return false;
      const matches = [...node.querySelectorAll(POPUPS)];
      if (node.matches(POPUPS)) matches.push(node);
      for (const popup of matches) {
        if (!popups.has(popup)) { popups.add(popup); resize.observe(popup); }
      }
      return matches.length > 0;
    };
    const observer = new MutationObserver((records) => {
      let changed = false;
      for (const record of records) {
        if (record.type === 'attributes') changed ||= record.target.matches(POSITIONERS);
        else for (const node of record.addedNodes) changed = discover(node) || changed;
      }
      if (changed) sync();
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });
    const app = document.querySelector('.app');
    if (app) resize.observe(app);
    discover(document.body);
    document.addEventListener('scroll', sync, true);
    window.addEventListener('resize', sync);
    image.onload = sync;
    image.src = imageUrl;
    sync();
    return () => {
      observer.disconnect(); resize.disconnect(); image.onload = null;
      document.removeEventListener('scroll', sync, true);
      window.removeEventListener('resize', sync);
      for (const name of ['image', 'size', 'x', 'y']) root.style.removeProperty(`--moki-background-${name}`);
      for (const popup of popups) {
        popup.style.removeProperty('--moki-popup-x'); popup.style.removeProperty('--moki-popup-y');
      }
    };
  }, [enabled, imageUrl]);

  useLayoutEffect(() => {
    const root = document.documentElement;
    if (enabled) root.style.setProperty('--moki-background-opacity', String(opacity));
    return () => root.style.removeProperty('--moki-background-opacity');
  }, [enabled, opacity]);
}
