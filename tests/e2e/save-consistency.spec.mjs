import { test, expect } from '@playwright/test';

function installDisk() {
  const key = 'trial-save-disk';
  let callbackId = 0;
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
    transformCallback: () => ++callbackId, unregisterCallback() {},
    invoke: async (command, args = {}) => {
      if (command === 'read_file_content') return { success: true, content: localStorage.getItem(key) || '', encoding: 'UTF-8' };
      if (command === 'save_file') {
        localStorage.setItem(key, args.content);
        return { success: true, file_path: args.filePath };
      }
      if (command === 'read_recovery_snapshot') return JSON.parse(localStorage.getItem('trial-recovery') || 'null');
      if (command === 'write_recovery_snapshot') { localStorage.setItem('trial-recovery', JSON.stringify(args.snapshot)); return; }
      if (command === 'clear_recovery_snapshot') { localStorage.removeItem('trial-recovery'); return; }
      if (['history_list', 'list_language_plugins', 'get_cli_args', 'get_directory_contents'].includes(command)) return [];
      if (command === 'get_refresh_credential') return null;
      if (command.startsWith('plugin:event|')) return 1;
      if (command.includes('is_')) return false;
      return true;
    },
  };
}

for (const mode of ['edit', 'preview']) {
  test(`${mode} saves the latest typed text, clears the dot, and reopens without recovery conflict`, async ({ page }) => {
    test.setTimeout(60000);
    await page.goto('/');
    await expect(page.locator('.editor-content__welcome')).toBeVisible({ timeout: 30000 });
    await page.evaluate(installDisk);
    await page.evaluate(async (viewMode) => {
      const { default: store } = await import('/src/store/useEditorStore.js');
      const { default: config } = await import('/src/store/useConfigStore.js');
      const { default: i18n } = await import('/src/i18n/index.js');
      await i18n.changeLanguage('en');
      config.getState().setConfig('autoSave', false);
      localStorage.setItem('trial-save-disk', 'base\n');
      store.getState().openFile({ path: '/consistency.md', name: 'consistency.md', content: 'base\n' });
      store.getState().setViewMode(viewMode);
    }, mode);
    if (mode === 'edit') {
      const input = page.locator('.monaco-editor textarea').first();
      await expect(input).toBeVisible(); await input.focus();
      await page.keyboard.press('Control+End');
    } else {
      await page.locator('.milkdown-editor > p').click();
      await page.keyboard.press('End');
    }
    await page.keyboard.insertText('最后输入的中文');
    // Save immediately, before Milkdown's 200 ms publication timer can run.
    await page.keyboard.press('Control+s');
    await expect(page.locator('.notif--success .notif__title', { hasText: 'File saved' })).toHaveCount(1);
    expect(await page.evaluate(() => localStorage.getItem('trial-save-disk'))).toContain('最后输入的中文');
    await expect(page.locator('.tabbar__tab-dot')).toHaveCount(0);
    await page.waitForTimeout(650);
    await expect(page.locator('.tabbar__tab-dot')).toHaveCount(0);
    await page.evaluate(async () => {
      const { default: store } = await import('/src/store/useEditorStore.js');
      const { getBuffer } = await import('/src/utils/editorBuffer.js');
      const tab = store.getState().tabs[0];
      if (tab.modified || tab.content !== getBuffer(tab.id) || tab.content !== localStorage.getItem('trial-save-disk')) throw new Error('Saved state disagrees with disk');
      const { flushRecoverySnapshot } = await import('/src/services/recoveryService.js');
      const { flushEditorSession } = await import('/src/services/editorSession.js');
      await flushRecoverySnapshot(); flushEditorSession();
    });
    expect(await page.evaluate(() => localStorage.getItem('trial-recovery'))).toBeNull();
    await page.addInitScript(installDisk);
    await page.reload();
    await expect(page.locator(mode === 'edit' ? '.monaco-editor .view-lines' : '.milkdown-editor')).toContainText('最后输入的中文');
    await expect(page.locator('.tabbar__tab-dot')).toHaveCount(0);
    await expect(page.getByText('恢复未保存内容', { exact: true })).toHaveCount(0);
    await expect(page.getByText('磁盘文件也已变化', { exact: true })).toHaveCount(0);
  });
}
