// One worker serves preview and outline. Each document keeps only its newest
// queued revision; identical requests share a promise and one copy of the text.
export function createMarkdownAnalysisClient(createWorker, idleMs = 30000) {
  const cache = new Map();
  const pending = new Map();
  let worker = null;
  let active = null;
  let sequence = 0;
  let idleTimer;
  const stop = () => { worker?.terminate(); worker = null; };
  const fail = (error) => {
    stop(); active?.reject(error); active = null;
    for (const entry of pending.values()) entry.reject(error);
    pending.clear(); cache.clear();
  };
  const run = () => {
    if (active || !pending.size) return;
    clearTimeout(idleTimer);
    const [documentId, entry] = pending.entries().next().value;
    pending.delete(documentId);
    active = entry;
    try {
      if (!worker) {
        worker = createWorker();
        worker.onmessage = ({ data }) => {
          if (!active || data?.id !== active.id) return;
          const finished = active;
          active = null;
          finished.resolve(cache.get(finished.documentId) === finished ? data.result : null);
          if (pending.size) run();
          else idleTimer = setTimeout(stop, idleMs);
        };
        worker.onerror = (event) => fail(new Error(event.message || 'Markdown analysis worker failed'));
        worker.onmessageerror = () => fail(new Error('Invalid Markdown analysis response'));
      }
      worker.postMessage({ id: entry.id, content: entry.content });
    } catch (error) { fail(error); }
  };
  return {
    analyze(documentId, content) {
      const previous = cache.get(documentId);
      if (previous?.content === content) return previous.promise;
      const entry = { id: ++sequence, documentId, content };
      entry.promise = new Promise((resolve, reject) => { entry.resolve = resolve; entry.reject = reject; });
      pending.get(documentId)?.resolve(null);
      pending.set(documentId, entry);
      cache.delete(documentId); cache.set(documentId, entry);
      while (cache.size > 4) {
        const oldest = cache.keys().next().value;
        cache.delete(oldest);
        pending.get(oldest)?.resolve(null); pending.delete(oldest);
      }
      run();
      return entry.promise;
    },
    dispose() {
      clearTimeout(idleTimer);
      fail(new Error('Markdown analysis client disposed'));
    },
  };
}

export const markdownAnalysis = createMarkdownAnalysisClient(() =>
  new Worker(new URL('../workers/markdownAnalysis.worker.js', import.meta.url), { type: 'module' }));
