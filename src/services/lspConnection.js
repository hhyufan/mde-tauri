import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

const connections = new Map();
let subscription;
async function ensureEvents() {
  if (!subscription) subscription = listen('lsp-message', ({ payload }) => {
    connections.get(payload.sessionId)?.receive(payload);
  }).catch((error) => { subscription = null; throw error; });
  return subscription;
}

/** A JSON-RPC connection, with ordered writes, cancellation, and bounded waits. */
export class LspConnection {
  constructor(onNotification = () => {}, onExit = () => {}, configuration = {}) {
    this.id = crypto.randomUUID();
    this.nextId = 0;
    this.pending = new Map();
    this.queue = Promise.resolve();
    this.onNotification = onNotification;
    this.onExit = onExit;
    this.configuration = configuration;
    this.closed = false;
    this.logs = '';
  }
  async start(request) {
    await ensureEvents();
    if (this.closed) throw new Error('LSP connection closed');
    connections.set(this.id, this);
    try {
      this.document = await invoke('start_lsp', { request: { ...request, sessionId: this.id } });
      if (this.closed) {
        await invoke('stop_lsp', { sessionId: this.id });
        throw new Error('LSP connection closed');
      }
      return this.document;
    } catch (error) { this.dispose(); throw error; }
  }
  send(message) {
    const write = this.queue.then(() => {
      if (this.closed) throw new Error('LSP connection closed');
      return invoke('send_lsp', { sessionId: this.id, message: { jsonrpc: '2.0', ...message } });
    });
    this.queue = write.catch(() => {});
    return write;
  }
  notify(method, params) { return this.send({ method, params }); }
  request(method, params, token, timeout = 15000) {
    if (this.closed || token?.isCancellationRequested) return Promise.reject(new Error('LSP request cancelled'));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      let cancellation;
      const timer = setTimeout(() => {
        finish(new Error(`LSP request timed out: ${method}`));
        this.notify('$/cancelRequest', { id }).catch(() => {});
      }, timeout);
      const finish = (error, result) => {
        if (!this.pending.delete(id)) return;
        clearTimeout(timer); cancellation?.dispose();
        if (error) reject(error); else resolve(result);
      };
      this.pending.set(id, finish);
      cancellation = token?.onCancellationRequested(() => {
        finish(new Error('LSP request cancelled'));
        this.notify('$/cancelRequest', { id }).catch(() => {});
      });
      this.send({ id, method, params }).catch((error) => finish(error));
    });
  }
  receive({ kind, message }) {
    if (this.closed) return;
    if (kind === 'log') { this.logs = `${this.logs}${message}`.slice(-8192); return; }
    if (kind === 'exit' || kind === 'error') {
      this.onExit(this.logs.trim() || (kind === 'exit' ? `Language server exited (${message ?? 'unknown exit code'})` : String(message)));
      this.dispose();
      return;
    }
    if (kind !== 'message') return;
    if (message.method) {
      if (message.id != null) {
        let result = null;
        switch (message.method) {
          case 'workspace/configuration':
            result = (message.params?.items || []).map(({ section }) => {
              if (!section || section === 'rust-analyzer') return this.configuration;
              return section.split('.').reduce((value, key) => value?.[key], this.configuration) ?? null;
            }); break;
          case 'workspace/workspaceFolders':
            result = this.document ? [{ uri: this.document.rootUri, name: 'workspace' }] : []; break;
          case 'client/registerCapability':
          case 'client/unregisterCapability':
          case 'window/workDoneProgress/create': break;
          case 'workspace/diagnostic/refresh': break;
          case 'workspace/applyEdit': result = { applied: false, failureReason: 'Workspace edits are not supported' }; break;
          case 'window/showMessageRequest': break;
          default:
            this.send({ id: message.id, error: { code: -32601, message: `Unsupported client method: ${message.method}` } }).catch(() => {});
            return;
        }
        this.send({ id: message.id, result }).catch(() => {});
      }
      this.onNotification(message.method, message.params);
    } else if (message.id != null) {
      this.pending.get(message.id)?.(message.error ? new Error(message.error.message) : null, message.result);
    }
  }
  dispose() {
    if (this.closed) return;
    this.closed = true;
    connections.delete(this.id);
    for (const finish of [...this.pending.values()]) finish(new Error('LSP connection closed'));
    invoke('stop_lsp', { sessionId: this.id }).catch(() => {});
  }
}
if (import.meta.hot) import.meta.hot.dispose(() => {
  for (const connection of connections.values()) connection.dispose();
  subscription?.then((stop) => stop());
});
