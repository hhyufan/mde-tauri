import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
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
const appConfig = JSON.parse(await readFile(path.join(root, 'src-tauri/tauri.conf.json'), 'utf8'));
const version = appConfig.version;
const updaterArtifacts = Boolean(process.env.TAURI_SIGNING_PRIVATE_KEY);
run('scripts/tauri.mjs', [
  args.includes('--reuse-app') ? 'bundle' : 'build',
  '--bundles',
  args.includes('--with-msi') ? 'nsis,msi' : 'nsis',
  '--config',
  JSON.stringify({ bundle: { createUpdaterArtifacts: updaterArtifacts } }),
]);
const payload = path.join(
  root,
  `src-tauri/target/release/bundle/nsis/mokidown_${version}_x64-setup.exe`,
);
const installerConfigPath = path.join(root, 'installer/src-tauri/tauri.conf.json');
const installerConfig = JSON.parse(await readFile(installerConfigPath, 'utf8'));
installerConfig.version = version;
await writeFile(installerConfigPath, JSON.stringify(installerConfig, null, 2) + '\n');
const cargoPath = path.join(root, 'installer/src-tauri/Cargo.toml');
const cargo = await readFile(cargoPath, 'utf8');
await writeFile(
  cargoPath,
  cargo.replace(/(\[package\][\s\S]*?\nversion = ")[^"]+"/, `$1${version}"`),
);
run('node_modules/vite/bin/vite.js', ['build', '--config', 'installer/vite.config.mjs']);
run(path.join(root, 'scripts/react-installer.mjs'), ['build', '--no-bundle'], {
  env: { ...process.env, MOKI_INSTALLER_PAYLOAD: payload },
});
const output = path.join(root, 'src-tauri/target/release/bundle/react');
await mkdir(output, { recursive: true });
const destination = path.join(output, `MokiDown_${version}_x64-setup.exe`);
await copyFile(
  path.join(root, 'src-tauri/target/react-installer/release/mokidown-installer.exe'),
  destination,
);
console.log(`React installer: ${destination}`);
