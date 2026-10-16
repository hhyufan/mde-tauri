import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { releaseManifest } from './create-update-manifest.mjs';
test('the updater downloads the exact same branded installer as Release users', () => {
  const result = releaseManifest({
    version: '1.2.3',
    signature: 'signed-wrapper\n',
    repository: 'hhyufan/mokidown',
    date: '2026-10-16T00:00:00Z',
  });
  assert.equal(
    result.platforms['windows-x86_64'].url,
    'https://github.com/hhyufan/mokidown/releases/download/v1.2.3/MokiDown_1.2.3_x64-setup.exe',
  );
  assert.equal(result.platforms['windows-x86_64'].signature, 'signed-wrapper');
  assert.deepEqual(result.platforms['windows-x86_64-msi'], result.platforms['windows-x86_64']);
  assert.deepEqual(result.platforms['windows-x86_64-nsis'], result.platforms['windows-x86_64']);
});

test('the OSS manifest serves the identical installer from OSS', () => {
  const result = releaseManifest({
    version: '1.2.3',
    signature: 'signed-wrapper',
    repository: 'hhyufan/mokidown',
    date: '2026-10-16T00:00:00Z',
    // 带结尾斜杠，顺便验证会归一化，不会拼出双斜杠
    downloadBase: 'https://mokidown-updates.oss-cn-hangzhou.aliyuncs.com/updates/',
  });
  assert.equal(
    result.platforms['windows-x86_64'].url,
    'https://mokidown-updates.oss-cn-hangzhou.aliyuncs.com/updates/MokiDown_1.2.3_x64-setup.exe',
  );
  assert.equal(result.platforms['windows-x86_64'].signature, 'signed-wrapper');
  assert.deepEqual(result.platforms['windows-x86_64-nsis'], result.platforms['windows-x86_64']);
  assert.deepEqual(result.platforms['windows-x86_64-msi'], result.platforms['windows-x86_64']);
});

test('release configuration uses the current repository and wires silent installation progress', async () => {
  const config = JSON.parse(
    await readFile(new URL('../src-tauri/tauri.conf.json', import.meta.url)),
  );
  const installer = JSON.parse(
    await readFile(new URL('../installer/src-tauri/tauri.conf.json', import.meta.url)),
  );
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url)));
  assert.equal(config.version, pkg.version);
  assert.equal(installer.version, config.version);
  // 顺序即优先级：国内先走 OSS（快、稳），OSS 走不通再退到 GitHub。
  // 客户端按顺序试，任一成功即停；三个都失败才报错。
  assert.deepEqual(config.plugins.updater.endpoints, [
    'https://mokidown-updates.oss-cn-hangzhou.aliyuncs.com/updates/latest.json',
    'https://mokidown-updates.oss-accelerate.aliyuncs.com/updates/latest.json',
    'https://github.com/hhyufan/mokidown/releases/latest/download/latest.json',
  ]);
  assert.equal(config.bundle.windows.nsis.template, 'windows/installer.nsi');
  assert.equal(config.bundle.windows.nsis.installerHooks, 'windows/progress.nsh');
});
test('unsigned installers and invalid versions cannot become update manifests', () => {
  assert.throws(() => releaseManifest({ version: '1.2.3', signature: '', repository: 'a/b' }));
  assert.throws(() => releaseManifest({ version: '../bad', signature: 'sig', repository: 'a/b' }));
});
