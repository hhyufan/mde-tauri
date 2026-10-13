import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createMarkdownAnalysisClient } from './markdownAnalysis';

let worker, createWorker, client;
beforeEach(() => {
  vi.useFakeTimers();
  worker = { postMessage: vi.fn(), terminate: vi.fn() };
  createWorker = vi.fn(() => worker);
  client = createMarkdownAnalysisClient(createWorker, 1000);
});
afterEach(() => { client.dispose(); vi.useRealTimers(); });
const finish = (result) => worker.onmessage({ data: { id: worker.postMessage.mock.calls.at(-1)[0].id, result } });

it('shares one worker job between preview and outline and reuses completed results', async () => {
  const first = client.analyze('a', 'large source');
  expect(client.analyze('a', 'large source')).toBe(first);
  finish({ footnotes: 'processed', outline: [] });
  expect(await first).toEqual({ footnotes: 'processed', outline: [] });
  expect(client.analyze('a', 'large source')).toBe(first);
  const next = client.analyze('a', 'changed source');
  finish({ footnotes: 'changed', outline: [] });
  await next;
  expect(createWorker).toHaveBeenCalledTimes(1);
  expect(worker.postMessage).toHaveBeenCalledTimes(2);
});

it('supersedes queued revisions and never returns an obsolete active result', async () => {
  const old = client.analyze('a', 'old');
  const skipped = client.analyze('a', 'intermediate');
  const latest = client.analyze('a', 'latest');
  expect(await skipped).toBeNull();
  expect(worker.postMessage).toHaveBeenCalledTimes(1);
  finish({ footnotes: 'old' });
  expect(await old).toBeNull();
  expect(worker.postMessage).toHaveBeenCalledTimes(2);
  expect(worker.postMessage.mock.calls[1][0].content).toBe('latest');
  finish({ footnotes: 'latest' });
  expect(await latest).toEqual({ footnotes: 'latest' });
});

it('keeps different documents isolated and releases an idle worker', async () => {
  const first = client.analyze('a', 'one');
  const second = client.analyze('b', 'two');
  finish({ footnotes: 'one' });
  expect(await first).toEqual({ footnotes: 'one' });
  finish({ footnotes: 'two' });
  await second;
  vi.advanceTimersByTime(1000);
  expect(worker.terminate).toHaveBeenCalledOnce();
  expect(await client.analyze('b', 'two')).toEqual({ footnotes: 'two' });
  expect(createWorker).toHaveBeenCalledOnce();
});

it('rejects failed work, releases its worker and permits a new request', async () => {
  const pending = client.analyze('a', 'one');
  const assertion = expect(pending).rejects.toThrow('crashed');
  worker.onerror({ message: 'crashed' });
  await assertion;
  const next = client.analyze('a', 'one');
  finish({ footnotes: 'recovered' });
  expect(await next).toEqual({ footnotes: 'recovered' });
  expect(createWorker).toHaveBeenCalledTimes(2);
});
