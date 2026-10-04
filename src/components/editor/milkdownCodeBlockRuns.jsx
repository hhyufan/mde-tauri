import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import CodeBlockExecution from './CodeBlockExecution';
import { getCodeBlockLanguage } from '@/services/scriptRunner';
import { codeBlockKey } from '@utils/markdownCodeBlocks';

// Attach controls to opaque code-block node views. Source always comes from the
// ProseMirror document, never highlighted DOM or previously rendered output.
export function attachCodeBlockExecutions({ root, getView, documentId, filePath, fileName }) {
  const mounts = new Map();
  let frame = 0;
  let disposed = false;
  const sync = () => {
    frame = 0;
    if (disposed) return;
    const view = getView();
    if (!view) return;
    const seen = new Set();
    let index = 0;
    view.state.doc.descendants((node, pos) => {
      if (node.type.name !== 'code_block') return;
      const blockIndex = index++;
      const language = getCodeBlockLanguage(node.attrs.language);
      const host = view.nodeDOM(pos);
      if (!language || !(host instanceof HTMLElement) || !root.contains(host)) return false;
      seen.add(host);
      let mount = mounts.get(host);
      if (!mount) {
        const element = document.createElement('div');
        element.className = 'md-code-execution-mount';
        element.contentEditable = 'false';
        host.appendChild(element);
        mount = { element, react: createRoot(element), source: null };
        mounts.set(host, mount);
      }
      // Milkdown virtualizes off-screen CodeMirror views and replaces children.
      if (!host.contains(mount.element)) host.appendChild(mount.element);
      const source = node.textContent;
      const blockKey = codeBlockKey(documentId, blockIndex);
      if (mount.source !== source || mount.language !== language || mount.key !== blockKey) {
        Object.assign(mount, { source, language, key: blockKey });
        mount.react.render(createElement(CodeBlockExecution, { blockKey, language, source, filePath, fileName }));
      }
      return false;
    });
    for (const [host, mount] of mounts) {
      if (seen.has(host)) continue;
      mount.react.unmount(); mount.element.remove(); mounts.delete(host);
    }
  };
  const schedule = () => { if (!disposed && !frame) frame = requestAnimationFrame(sync); };
  const observer = new MutationObserver((records) => {
    if (records.some((record) => !record.target.parentElement?.closest('.md-code-execution-mount') &&
      !record.target.closest?.('.md-code-execution-mount'))) schedule();
  });
  observer.observe(root, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['data-language'] });
  schedule();
  return () => {
    disposed = true; observer.disconnect(); cancelAnimationFrame(frame);
    for (const mount of mounts.values()) {
      // Cleanup can be called during a React parent commit.
      queueMicrotask(() => { mount.react.unmount(); mount.element.remove(); });
    }
    mounts.clear();
  };
}
