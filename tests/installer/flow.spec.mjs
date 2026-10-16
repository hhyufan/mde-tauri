import { expect, test } from '@playwright/test';

test('feature navigation, preview installation and duplicate-click protection', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('button', { name: '开始安装', exact: false })).toBeEnabled();
  await expect(page.getByText('交互设计预览 · 不会安装文件')).toBeVisible();
  await page.getByRole('button', { name: 'ORGANIZE', exact: true }).click();
  await expect(page.getByRole('heading', { name: /让零散灵感/ })).toBeVisible();
  await expect(page.getByRole('img', { name: '浅色 Moki 整理文件，蓝白系带运动鞋' })).toBeVisible();
  await page.getByRole('button', { name: '开始安装', exact: false }).click();
  await expect(page.getByRole('button', { name: '正在安装' })).toBeDisabled();
  await page.getByRole('button', { name: '关闭安装器', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: '知道了' }).click();
  await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100', {
    timeout: 15000,
  });
  await expect(page.getByText('安装完成，正在启动 MokiDown…')).toBeVisible();
  await expect(page.getByRole('button', { name: /开始使用/ })).toHaveCount(0);
  expect(errors).toEqual([]);
});

async function nativeInstaller(page, update) {
  await page.addInitScript(
    ({ update }) => {
      const callbacks = new Map();
      let sequence = 0;
      window.installCalls = [];
      window.isTauri = true;
      window.__TAURI_INTERNALS__ = {
        metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
        transformCallback(callback) {
          callbacks.set(++sequence, callback);
          return sequence;
        },
        unregisterCallback(id) {
          callbacks.delete(id);
        },
        invoke(command, args) {
          window.installCalls.push({ command, args });
          if (command === 'startup_info')
            return Promise.resolve({ update, directory: 'C:\\Work Space\\笔记\\MokiDown' });
          if (command === 'install_application')
            return new Promise((resolve) => {
              window.completeInstallation = resolve;
            });
          return Promise.resolve(1);
        },
      };
    },
    { update },
  );
  await page.goto('/');
}

test('update mode automatically installs and returns to the editor without action buttons', async ({
  page,
}) => {
  await nativeInstaller(page, true);
  await expect
    .poll(() =>
      page.evaluate(
        () => window.installCalls.filter((c) => c.command === 'install_application').length,
      ),
    )
    .toBe(1);
  await expect(page.getByRole('button', { name: /开始安装|立即更新|开始使用/ })).toHaveCount(0);
  await expect(page.getByLabel('安装位置', { exact: true })).toHaveCount(0);
  await page.evaluate(() => window.completeInstallation());
  await expect
    .poll(() =>
      page.evaluate(() => window.installCalls.some((c) => c.command === 'plugin:window|close')),
    )
    .toBe(true);
  const launches = await page.evaluate(() =>
    window.installCalls.filter((c) => c.command === 'launch_application'),
  );
  expect(launches).toHaveLength(1);
  expect(launches[0].args).toEqual({ afterUpdate: true });
});

test('first installation uses the same installer and opens the app automatically on completion', async ({
  page,
}) => {
  await nativeInstaller(page, false);
  await page.getByRole('button', { name: '开始安装', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () => window.installCalls.filter((c) => c.command === 'install_application').length,
      ),
    )
    .toBe(1);
  await page.evaluate(() => window.completeInstallation());
  await expect
    .poll(() =>
      page.evaluate(() => window.installCalls.some((c) => c.command === 'plugin:window|close')),
    )
    .toBe(true);
  const calls = await page.evaluate(() => window.installCalls);
  expect(calls.find((c) => c.command === 'install_application').args.directory).toBe(
    'C:\\Work Space\\笔记\\MokiDown',
  );
  expect(calls.find((c) => c.command === 'launch_application').args).toEqual({
    afterUpdate: false,
  });
  await expect(page.getByRole('button', { name: /开始使用/ })).toHaveCount(0);
});

test('reduced motion disables decorative motion and empty path blocks installation', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.getByLabel('安装位置', { exact: true })).not.toHaveValue('');
  await page.getByLabel('安装位置', { exact: true }).fill('');
  await expect(page.getByRole('button', { name: /开始安装/ })).toBeDisabled();
  const animation = await page
    .locator('.card-motion')
    .evaluate((el) => getComputedStyle(el).animationName);
  expect(animation).toBe('none');
});
