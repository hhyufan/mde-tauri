import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, readFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
if (args.includes('--reuse-app')) {
  throw new Error('Reusing an old application can embed stale updater settings. Build the current app instead.');
}
function run(script, args = [], options = {}) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${script} failed (${result.status})`);
}
run('scripts/sync-version.mjs');
const appConfig = JSON.parse(await readFile(path.join(root, 'src-tauri/tauri.conf.json'), 'utf8'));
const version = appConfig.version;
const updaterArtifacts = Boolean(process.env.TAURI_SIGNING_PRIVATE_KEY);
run('scripts/tauri.mjs', [
  'build',
  '--bundles',
  args.includes('--with-msi') ? 'nsis,msi' : 'nsis',
  '--config',
  JSON.stringify({ bundle: { createUpdaterArtifacts: updaterArtifacts } }),
]);
const payload = path.join(
  root,
  `src-tauri/target/release/bundle/nsis/mokidown_${version}_x64-setup.exe`,
);
run('node_modules/vite/bin/vite.js', ['build', '--config', 'installer/vite.config.mjs']);
run(path.join(root, 'scripts/react-installer.mjs'), ['build', '--no-bundle'], {
  env: { ...process.env, MOKI_INSTALLER_PAYLOAD: payload },
});
// The branded React installer is the only release artifact. The NSIS bundle
// above is merely the payload embedded into it, so it stays where the bundler
// writes it.
const output = path.join(root, 'src-tauri/target/release/react');
await mkdir(output, { recursive: true });
const destination = path.join(output, `MokiDown_${version}_x64-setup.exe`);
// Rebuilding changes the signed bytes. Never leave an older signature/manifest
// next to the replacement executable, including when the copy fails.
await rm(`${destination}.sig`, { force: true });
await rm(path.join(output, 'latest.json'), { force: true });
await copyFile(
  path.join(root, 'src-tauri/target/react-installer/release/mokidown-installer.exe'),
  destination,
);
console.log(`React installer: ${destination}`);
