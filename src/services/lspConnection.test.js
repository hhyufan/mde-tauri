import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { LspConnection } from './lspConnection';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));
let events;
const clients = [];
beforeEach(() => {
  invoke.mockResolvedValue({ uri: 'file:///test.py', rootUri: 'file:///' });
  listen.mockImplementation(async (_name, callback) => { events = callback; return vi.fn(); });
});
afterEach(() => { clients.forEach((client) => client.dispose()); clients.length = 0; vi.clearAllMocks(); vi.useRealTimers(); });
async function client() {
  const connection = new LspConnection(); clients.push(connection);
  await connection.start({ language: 'python' });
  return connection;
}
it('subscribes before spawning and correlates out-of-order JSON-RPC responses', async () => {
  const connection = await client();
  expect(listen.mock.invocationCallOrder[0]).toBeLessThan(invoke.mock.invocationCallOrder[0]);
  const first = connection.request('first', {});
  const second = connection.request('second', {});
  events({ payload: { sessionId: connection.id, kind: 'message', message: { id: 2, result: 'second' } } });
  events({ payload: { sessionId: connection.id, kind: 'message', message: { id: 1, result: 'first' } } });
  await expect(first).resolves.toBe('first');
  await expect(second).resolves.toBe('second');
});
it('preserves didChange before completion even when IPC writes are delayed', async () => {
  const connection = await client();
  let release;
  invoke.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
  const change = connection.notify('textDocument/didChange', { version: 2 });
  const completion = connection.request('textDocument/completion', {});
  await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  expect(invoke.mock.calls.filter(([command]) => command === 'send_lsp')).toHaveLength(1);
  release(); await change;
  await vi.waitFor(() => expect(invoke.mock.calls.at(-1)[1].message.method).toBe('textDocument/completion'));
  connection.receive({ kind: 'message', message: { id: 1, result: [] } });
  await completion;
});
it('answers configuration and rejects workspace mutations', async () => {
  const connection = await client();
  connection.configuration = { python: { analysis: { typeCheckingMode: 'basic' } } };
  connection.receive({ kind: 'message', message: { id: 'config', method: 'workspace/configuration',
    params: { items: [{ section: 'python.analysis' }] } } });
  connection.receive({ kind: 'message', message: { id: 'edit', method: 'workspace/applyEdit', params: {} } });
  await vi.waitFor(() => expect(invoke.mock.calls.at(-1)[1].message.id).toBe('edit'));
  expect(invoke.mock.calls.find(([, args]) => args.message?.id === 'config')[1].message.result).toEqual([{ typeCheckingMode: 'basic' }]);
  expect(invoke.mock.calls.at(-1)[1].message.result.applied).toBe(false);
});
it('cancels requests and releases pending promises on server exit', async () => {
  const connection = await client();
  let cancel;
  const dispose = vi.fn();
  const request = connection.request('slow', {}, { onCancellationRequested: (callback) => { cancel = callback; return { dispose }; } });
  const rejected = expect(request).rejects.toThrow('cancelled'); cancel(); await rejected;
  expect(dispose).toHaveBeenCalled();
  const next = connection.request('next', {});
  const exited = expect(next).rejects.toThrow('closed');
  connection.receive({ kind: 'exit', message: 1 }); await exited;
  expect(connection.pending.size).toBe(0);
});
it('stops a server that finishes starting after its model was disposed', async () => {
  let spawned;
  invoke.mockImplementationOnce(() => new Promise((resolve) => { spawned = resolve; }));
  const connection = new LspConnection(); clients.push(connection);
  const starting = connection.start({ language: 'rust' });
  await vi.waitFor(() => expect(spawned).toBeTypeOf('function'));
  connection.dispose();
  const stopped = expect(starting).rejects.toThrow('closed');
  spawned({ uri: 'file:///main.rs', rootUri: 'file:///' });
  await stopped;
  expect(invoke.mock.calls.at(-1)).toEqual(['stop_lsp', { sessionId: connection.id }]);
});
it('acknowledges server diagnostic refresh requests and forwards them to the editor', async () => {
  const connection = await client();
  connection.onNotification = vi.fn();
  connection.receive({ kind: 'message', message: { id: 'refresh', method: 'workspace/diagnostic/refresh' } });
  await vi.waitFor(() => expect(invoke.mock.calls.at(-1)[1].message.id).toBe('refresh'));
  expect(invoke.mock.calls.at(-1)[1].message).toMatchObject({ id: 'refresh', result: null });
  expect(connection.onNotification).toHaveBeenCalledWith('workspace/diagnostic/refresh', undefined);
});
