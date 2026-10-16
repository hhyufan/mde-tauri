/**
 * @file 应用更新：读更新源、校验签名、下载安装、重启。
 *
 * 更新源是 tauri.conf.json 里 plugins.updater.endpoints 指向的 latest.json，
 * 由发布流程随自定义安装包一起发布到 GitHub Release。
 *
 * 只在 Tauri 桌面壳里可用；浏览器跑 dev server 时这些 API 不存在，
 * 所以调用方要先用 canCheckUpdates() 判断。
 */
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { isAndroidRuntime } from './platform';

/** 是否运行在 Tauri 桌面壳内。 */
export function canCheckUpdates() {
  return typeof window !== 'undefined' && Boolean(window.__TAURI_INTERNALS__)
    && !isAndroidRuntime() && !/iPhone|iPad|iPod/i.test(navigator.userAgent || '');
}

// Checking never downloads or installs; installation requires explicit consent.
export const checkForUpdate = () => check({ timeout: 15000 });

export async function installUpdate(update, onStage = () => {}) {
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
}

/** 重启应用以应用已安装的更新。 */
export const relaunchApp = relaunch;
