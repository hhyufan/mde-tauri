import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm, mkdir, readdir, readFile } from 'node:fs/promises';
import {
  markdownLinkContext,
  normalizeMarkdownPathItems,
  markdownDirectoryItems,
} from '../src/services/markdownLspPaths.js';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Usage: node scripts/markdown-lsp-smoke.mjs /path/to/marksman
const executable = resolve(process.argv[2] || '.cache/markdown-lsp-smoke/marksman.exe');
const directory = await mkdtemp(join(tmpdir(), 'mokidown-markdown-lsp-'));
const uri = pathToFileURL(join(directory, 'main.md')).href;
const notesUri = pathToFileURL(join(directory, 'notes.md')).href;
await writeFile(join(directory, '.marksman.toml'), '');
await writeFile(join(directory, 'notes.md'), '# Reading notes\n\n## Summary\n\nA note.\n');
const source = '# Main\n\n[Read](./no)\n\n[[missing-note]]\n';
await writeFile(join(directory, 'main.md'), source);
await mkdir(join(directory, 'sub/child'), { recursive: true });
await writeFile(join(directory, 'sub/main.md'), '# Nested');
await writeFile(join(directory, 'sub/sibling.md'), '# Sibling');
await writeFile(join(directory, 'sub/中文 #笔记.md'), '# 中文');
await writeFile(join(directory, 'sub/child/deep.md'), '# Deep');
const child = spawn(executable, ['server'], {
  cwd: directory,
  windowsHide: true,
  stdio: ['pipe', 'pipe', 'pipe'],
});
const pending = new Map();
const diagnostics = [];
let buffer = Buffer.alloc(0),
  sequence = 0,
  logs = '';
function send(message) {
  const body = JSON.stringify({ jsonrpc: '2.0', ...message });
  child.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
}
function request(method, params) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timeout: ${method}\n${logs}`));
    }, 15000);
    pending.set(id, (error, result) => {
      clearTimeout(timer);
      error ? reject(new Error(error.message)) : resolve(result);
    });
    send({ id, method, params });
  });
}
child.on('error', (error) => {
  for (const done of pending.values()) done(error);
  pending.clear();
});
child.on('exit', () => {
  for (const done of pending.values()) done({ message: `Server exited: ${logs}` });
  pending.clear();
});
child.stderr.on('data', (chunk) => {
  logs = `${logs}${chunk}`.slice(-8192);
});
child.stdout.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const end = buffer.indexOf('\r\n\r\n');
    if (end < 0) return;
    const length = Number(
      buffer
        .subarray(0, end)
        .toString()
        .match(/Content-Length:\s*(\d+)/i)?.[1],
    );
    if (!length || buffer.length < end + 4 + length) return;
    const message = JSON.parse(buffer.subarray(end + 4, end + 4 + length).toString());
    buffer = buffer.subarray(end + 4 + length);
    if (message.method === 'textDocument/publishDiagnostics') diagnostics.push(message.params);
    if (message.method && message.id != null) send({ id: message.id, result: null });
    else if (message.id != null) {
      pending.get(message.id)?.(message.error, message.result);
      pending.delete(message.id);
    }
  }
});
try {
  const initialized = await request('initialize', {
    processId: process.pid,
    rootUri: pathToFileURL(directory).href,
    workspaceFolders: [{ uri: pathToFileURL(directory).href, name: 'notes' }],
    capabilities: {
      general: { positionEncodings: ['utf-16'] },
      textDocument: { publishDiagnostics: { versionSupport: true } },
    },
  });
  assert.ok(initialized.capabilities.completionProvider);
  send({ method: 'initialized', params: {} });
  send({
    method: 'textDocument/didOpen',
    params: { textDocument: { uri, languageId: 'markdown', version: 1, text: source } },
  });
  const completion = await request('textDocument/completion', {
    textDocument: { uri },
    position: { line: 2, character: '[Read](./no'.length },
  });
  const items = Array.isArray(completion) ? completion : completion?.items || [];
  assert.ok(
    items.some((item) => /notes/i.test(item.label)),
    `Expected notes.md completion: ${JSON.stringify(items)}`,
  );
  const fixed = source.replace('./no)', './notes.md)');
  send({
    method: 'textDocument/didChange',
    params: { textDocument: { uri, version: 2 }, contentChanges: [{ text: fixed }] },
  });
  const definition = await request('textDocument/definition', {
    textDocument: { uri },
    position: { line: 2, character: 11 },
  });
  assert.ok(
    (Array.isArray(definition) ? definition : [definition]).some(
      (item) =>
        decodeURIComponent(item?.uri || item?.targetUri || '').toLowerCase() ===
        decodeURIComponent(notesUri).toLowerCase(),
    ),
    `Expected notes.md definition: ${JSON.stringify(definition)} vs ${notesUri}`,
  );
  const deadline = Date.now() + 10000;
  while (
    !diagnostics.some(
      (event) =>
        decodeURIComponent(event.uri).toLowerCase() === decodeURIComponent(uri).toLowerCase() &&
        event.diagnostics?.length,
    ) &&
    Date.now() < deadline
  )
    await new Promise((resolve) => setTimeout(resolve, 100));
  assert.ok(
    diagnostics.some(
      (event) =>
        decodeURIComponent(event.uri).toLowerCase() === decodeURIComponent(uri).toLowerCase() &&
        event.diagnostics?.length,
    ),
    'Expected missing-link diagnostics',
  );
  console.log(
    JSON.stringify(
      {
        completion: 'notes.md',
        definition: 'notes.md',
        diagnostics: diagnostics.flatMap((event) => event.diagnostics).map((item) => item.message),
      },
      null,
      2,
    ),
  );
  const nestedUri = pathToFileURL(join(directory, 'sub/main.md')).href;
  send({
    method: 'textDocument/didOpen',
    params: {
      textDocument: { uri: nestedUri, languageId: 'markdown', version: 1, text: '# Nested' },
    },
  });
  let version = 1;
  const pathCases = ['.', './', '..', '../', './child/', './中'];
  for (const prefix of pathCases) {
    const text = `[Read](${prefix})`;
    send({
      method: 'textDocument/didChange',
      params: { textDocument: { uri: nestedUri, version: ++version }, contentChanges: [{ text }] },
    });
    const response = await request('textDocument/completion', {
      textDocument: { uri: nestedUri },
      position: { line: 0, character: 7 + prefix.length },
    });
    const context = markdownLinkContext(
      { getValue: () => text },
      { lineNumber: 1, column: 8 + prefix.length },
    );
    const doc = { uri: nestedUri, rootUri: pathToFileURL(directory).href };
    const normalized = normalizeMarkdownPathItems(
      Array.isArray(response) ? response : response?.items || [],
      doc,
      context,
    );
    const local = await markdownDirectoryItems(context, doc, async (folder) =>
      (await readdir(folder, { withFileTypes: true })).map((item) => ({
        name: item.name,
        is_dir: item.isDirectory(),
      })),
    );
    const combined = [...normalized, ...local];
    const expected = prefix.startsWith('..')
      ? '../notes.md'
      : prefix.includes('child')
        ? './child/deep.md'
        : prefix.includes('中')
          ? './%E4%B8%AD%E6%96%87%20%23%E7%AC%94%E8%AE%B0.md'
          : './sibling.md';
    assert.ok(
      combined.some((item) => item.textEdit.newText === expected),
      `Expected ${expected} for ${prefix}`,
    );
    for (const item of combined.filter((item) => item.kind !== 19)) {
      assert.ok(
        !item.textEdit.newText.startsWith('/'),
        'Completion must not write a workspace-rooted path',
      );
      await readFile(new URL(item.textEdit.newText, nestedUri));
    }
  }
  console.log(`Relative-path completion and actual file reads passed: ${pathCases.join(', ')}`);
  await request('shutdown', null);
  send({ method: 'exit' });
} finally {
  child.kill();
  await new Promise((resolve) => {
    if (child.exitCode !== null) resolve();
    else child.once('exit', resolve);
  });
  await rm(directory, { recursive: true, force: true });
}
