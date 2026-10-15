/**
 * @file 应用更新：读更新源、校验签名、下载安装、重启。
 *
 * 更新源是 tauri.conf.json 里 plugins.updater.endpoints 指向的 latest.json，
 * 由发布流程（.github/workflows/release.yml）随安装包一起同步到对象存储。
 *
 * 只在 Tauri 桌面壳里可用；浏览器跑 dev server 时这些 API 不存在，
 * 所以调用方要先用 canCheckUpdates() 判断。
 */
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

/** 是否运行在 Tauri 桌面壳内。 */
export function canCheckUpdates() {
  return typeof window !== 'undefined' && Boolean(window.__TAURI_INTERNALS__);
}

/**
 * 检查更新；有则下载安装。
 *
 * @param {(stage: string, detail?: {version?: string, downloaded?: number, total?: number}) => void} onStage
 *   阶段回调，stage 取值：checking / up-to-date / available / downloading / installing
 * @returns {Promise<{status: 'up-to-date' | 'installed', version?: string}>}
 */
export async function checkAndInstallUpdate(onStage = () => {}) {
  onStage('checking');
  const update = await check();
  if (!update) {
    onStage('up-to-date');
    return { status: 'up-to-date' };
  }

  onStage('available', { version: update.version });
  let downloaded = 0;
  let total = 0;
  await update.downloadAndInstall((event) => {
    if (event.event === 'Started') {
      total = event.data?.contentLength ?? 0;
      onStage('downloading', { downloaded, total });
    } else if (event.event === 'Progress') {
      downloaded += event.data?.chunkLength ?? 0;
      onStage('downloading', { downloaded, total });
    } else if (event.event === 'Finished') {
      onStage('installing');
    }
  });
  return { status: 'installed', version: update.version };
}

/** 重启应用以应用已安装的更新。 */
export const relaunchApp = relaunch;
