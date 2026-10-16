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
  await expect(page.getByRole('button', { name: /开始使用/ })).toBeVisible();
  expect(errors).toEqual([]);
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
