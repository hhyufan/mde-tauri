import { useLayoutEffect } from 'react';

const POPUPS = '.footer__dropdown, .search-dropdown__panel, .ant-select-dropdown, .ant-dropdown-menu, .ant-picker-panel-container, .ft, .ft__heading-panel, .monaco-context-menu';
const POSITIONERS = '.ant-dropdown, .ant-picker-dropdown';

// Portal popups need the same image, cover dimensions and viewport coordinates
// as the workspace. Explicit coordinates also work inside transformed antd
// containers, where background-attachment: fixed uses a different origin.
export function useBackgroundSurfaces({ enabled, imageUrl, opacity }) {
  useLayoutEffect(() => {
    if (!enabled || !imageUrl) return undefined;
    const root = document.documentElement;
    const app = document.querySelector('.app');
    if (!app) return undefined;
    const popups = new Set();
    const positions = new Set();
    const writtenStyles = new WeakMap();
    const image = new Image();
    let frame = null;
    let workspaceDirty = true;
    const set = (el, name, value) => {
      if (el.style.getPropertyValue(name) !== value) el.style.setProperty(name, value);
    };
    set(root, '--moki-background-image', `url(${JSON.stringify(imageUrl)})`);
    const sync = () => {
      // Read every rectangle before writing any style to avoid repeated forced
      // layout. Workspace geometry stays cached while only a popup moves.
      const rect = workspaceDirty ? app.getBoundingClientRect() : null;
      const boxes = [];
      for (const popup of popups) {
        if (popup.isConnected) boxes.push([popup, popup.getBoundingClientRect()]);
      }
      if (rect && image.naturalWidth && image.naturalHeight) {
        const scale = Math.max(rect.width / image.naturalWidth, rect.height / image.naturalHeight);
        const width = image.naturalWidth * scale, height = image.naturalHeight * scale;
        set(root, '--moki-background-size', `${width}px ${height}px`);
        set(root, '--moki-background-x', `${rect.left + (rect.width - width) / 2}px`);
        set(root, '--moki-background-y', `${rect.top + (rect.height - height) / 2}px`);
      }
      workspaceDirty = false;
      for (const [popup, box] of boxes) {
        set(popup, '--moki-popup-x', `${box.left}px`);
        set(popup, '--moki-popup-y', `${box.top}px`);
        writtenStyles.set(popup, popup.getAttribute('style'));
      }
    };
    const schedule = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => { frame = null; sync(); });
    };
    const resize = new ResizeObserver((entries) => {
      if (entries.some(({ target }) => target === app)) workspaceDirty = true;
      // ResizeObserver runs before paint; keep the first visible frame aligned.
      sync();
    });
    const positionObserver = new MutationObserver((records) => {
      if (records.some((record) => record.attributeName !== 'style'
        || record.target.getAttribute('style') !== writtenStyles.get(record.target))) sync();
    });
    const observePosition = (element) => {
      if (positions.has(element)) return;
      positions.add(element);
      positionObserver.observe(element, { attributes: true, attributeFilter: ['style', 'class'] });
    };
    const discover = (node) => {
      if (!(node instanceof Element)) return false;
      const matches = node.firstElementChild ? [...node.querySelectorAll(POPUPS)] : [];
      if (node.matches(POPUPS)) matches.push(node);
      for (const popup of matches) {
        if (!popups.has(popup)) {
          popups.add(popup);
          resize.observe(popup);
          observePosition(popup);
          // Ant Design positions a portal wrapper rather than its inner card.
          for (let parent = popup.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
            if (parent.matches(POSITIONERS)) observePosition(parent);
          }
        }
      }
      return matches.length > 0;
    };
    const observer = new MutationObserver((records) => {
      let changed = false;
      for (const record of records) {
        for (const node of record.addedNodes) changed = discover(node) || changed;
      }
      let removed = false;
      for (const popup of popups) {
        if (!popup.isConnected) { popups.delete(popup); resize.unobserve(popup); removed = true; }
      }
      if (removed) {
        positionObserver.disconnect();
        positions.clear();
        for (const popup of popups) {
          observePosition(popup);
          for (let parent = popup.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
            if (parent.matches(POSITIONERS)) observePosition(parent);
          }
        }
      }
      // Discover synchronously before paint, not one animation frame later.
      if (changed) sync();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    resize.observe(app);
    discover(document.body);
    const scroll = ({ target }) => {
      const workspaceMoved = target === document || (target instanceof Element && target !== app && target.contains(app));
      const popupMoved = target instanceof Element
        && [...popups].some((popup) => target !== popup && target.contains(popup));
      // Scrolling editor text or a card's own list does not move the card.
      if (!workspaceMoved && !popupMoved) return;
      workspaceDirty ||= workspaceMoved;
      schedule();
    };
    const viewportResize = () => { workspaceDirty = true; schedule(); };
    document.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', viewportResize);
    image.onload = () => { workspaceDirty = true; sync(); };
    image.src = imageUrl;
    sync();
    return () => {
      observer.disconnect(); positionObserver.disconnect(); resize.disconnect(); image.onload = null;
      if (frame !== null) cancelAnimationFrame(frame);
      document.removeEventListener('scroll', scroll, true);
      window.removeEventListener('resize', viewportResize);
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
