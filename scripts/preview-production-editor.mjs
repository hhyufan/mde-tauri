import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
// Serve the *built* Monaco and Shiki chunks with the production CSP, including
// the style nonce Tauri adds to index.html. Vite dev does not reproduce this.
const root = path.resolve('dist');
const names = fs.readdirSync(path.join(root, 'assets'));
const asset = (prefix) => '/assets/' + names.find(n => n.startsWith(prefix + '-') && n.endsWith('.js'));
const config = JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json', 'utf8'));
const csp = config.app.security.csp.replace("style-src 'self' 'unsafe-inline'", "style-src 'self' 'unsafe-inline' 'nonce-production-test'");
const js = `
const workers = ${JSON.stringify({editor:asset('editor.worker'),json:asset('json.worker'),css:asset('css.worker'),html:asset('html.worker'),typescript:asset('ts.worker')})};
globalThis.MonacoEnvironment = { getWorker(_, label) {
  const kind = label === 'javascript' ? 'typescript' : ['scss','less'].includes(label) ? 'css' : ['handlebars','razor'].includes(label) ? 'html' : label;
  return new Worker(workers[kind] || workers.editor, {type:'module'});
}};
const report = document.querySelector('#report');
const notes = [];
const log = (text) => { notes.push(text); report.textContent = notes.join('\\n'); };
window.addEventListener('securitypolicyviolation', e => log('CSP: ' + e.violatedDirective + ' ' + e.blockedURI));
window.addEventListener('error', e => log('ERROR: ' + e.message));
window.addEventListener('unhandledrejection', e => log('REJECTION: ' + e.reason));
const originalError = console.error;
console.error = (...args) => { log(args.map(String).join(' ')); originalError(...args); };
try {
  const boot = await import('${asset('monacoRuntimeBoot')}');
  await boot.prepareMonacoRuntime();
  const exports = await import('${asset('monaco-vendor')}');
  const monaco = Object.values(exports).find(v => v?.editor && v?.languages);
  const highlighterExports = await import('${asset('monacoShiki')}');
  const highlighter = highlighterExports.isMonacoShikiReady ? highlighterExports
    : Object.values(highlighterExports).find(v => v?.isMonacoShikiReady && v?.getMonacoThemeName);
  log('highlighterReady: ' + highlighter.isMonacoShikiReady());
  log('editorFrozen: ' + Object.isFrozen(monaco.editor));
  const editor = monaco.editor.create(document.querySelector('#editor'), {
    value: '# Markdown\\n\\n**bold** and \\x60inline\\x60\\n\\n\\x60\\x60\\x60javascript\\nconst answer = 42; // comment\\n\\x60\\x60\\x60\\n',
    language: 'markdown', theme: highlighter.getMonacoThemeName(false), automaticLayout: true,
  });
  editor.onDidCompositionStart(() => log('composition:start'));
  editor.onDidCompositionEnd(() => log('composition:end'));
  editor.onDidChangeModelContent(() => { document.querySelector('#value').textContent = editor.getValue(); });
  document.querySelector('#dark').onclick = () => { monaco.editor.setTheme(highlighter.getMonacoThemeName(true)); };
  document.querySelector('#light').onclick = () => { monaco.editor.setTheme(highlighter.getMonacoThemeName(false)); };
  log('editorCreated: true');
} catch (error) { log('BOOT ERROR: ' + error.stack); }
`;
const html = '<!doctype html><html><head><meta charset="UTF-8"><title>Production editor verification</title><style nonce="production-test">body{margin:0;font:14px system-ui}#editor{height:55vh}pre{white-space:pre-wrap;max-height:28vh;overflow:auto}</style></head><body><button id="dark">Dark</button><button id="light">Light</button><div id="editor"></div><pre id="report"></pre><pre id="value"></pre><script type="module" src="/check.js"></script></body></html>';
http.createServer((req,res) => {
  res.setHeader('Content-Security-Policy', csp);
  if (req.url === '/') { res.setHeader('Content-Type','text/html'); return res.end(html); }
  if (req.url === '/check.js') { res.setHeader('Content-Type','text/javascript'); return res.end(js); }
  const file = path.resolve(root, '.' + decodeURIComponent(req.url.split('?')[0]));
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  const types = {'.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.woff2':'font/woff2'};
  res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
}).listen(4174,'127.0.0.1',() => console.log('Production editor verification: http://127.0.0.1:4174'));
