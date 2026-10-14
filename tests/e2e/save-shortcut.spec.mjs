import { test, expect } from '@playwright/test';

test('one save shortcut in Monaco produces one saved notification and one save operation', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto('/');
  await expect(page.locator('.editor-content__welcome')).toBeVisible({ timeout: 30000 });
  await page.evaluate(async () => {
    const { default: editor } = await import('/src/store/useEditorStore.js');
    const { default: config } = await import('/src/store/useConfigStore.js');
    const { default: notices } = await import('/src/store/useNotificationStore.js');
    const { default: i18n } = await import('/src/i18n/index.js');
    await i18n.changeLanguage('en');
    config.getState().setConfig('autoSave', false);
    config.getState().setConfig('hotkeys', {});
    notices.setState({ notifications: [] });
    window.saveReads = 0;
    window.__TAURI_INTERNALS__ = {
      invoke: async (command) => {
        if (command === 'history_list') return [];
        if (command === 'read_file_content') {
          window.saveReads++;
          return { success: true, content: 'saved content', encoding: 'UTF-8' };
        }
        return { success: true };
      },
      transformCallback: () => 1,
      unregisterCallback: () => {},
    };
    editor.getState().openFile({ path: '/save.md', name: 'save.md', content: 'saved content' });
    editor.getState().setViewMode('edit');
  });
  const input = page.locator('.monaco-editor textarea').first();
  await expect(input).toBeVisible();
  await input.focus();
  await page.keyboard.press('Control+s');
  await expect(page.locator('.notif--success .notif__title', { hasText: 'File saved' })).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => window.saveReads)).toBe(1);
  // A second deliberate save is still allowed; this must not be a toast deduper.
  await page.keyboard.press('Control+s');
  await expect(page.locator('.notif--success .notif__title', { hasText: 'File saved' })).toHaveCount(2);
  await expect.poll(() => page.evaluate(() => window.saveReads)).toBe(2);
});
