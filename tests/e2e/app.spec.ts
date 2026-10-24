import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => join(here, '..', '..', 'public', 'fixtures', name);

test.describe('GhostPixel 核心流程', () => {
  test('上传含 EXIF/GPS 的图片 → 显示元数据 → 清理 → 下载', async ({ page }) => {
    const externalRequests: string[] = [];
    page.on('request', (req) => {
      const url = req.url();
      if (!/^http:\/\/127\.0\.0\.1:4399/.test(url) && !url.startsWith('blob:') && !url.startsWith('data:')) {
        externalRequests.push(url);
      }
    });

    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    // 顶部作者 X 链接必须存在且指向正确地址
    const xLink = page.getByTestId('x-link');
    await expect(xLink).toBeVisible();
    await expect(xLink).toHaveAttribute('href', 'https://x.com/0xkillcoin');

    await page.getByTestId('file-input').setInputFiles(fixture('with-exif-gps.jpg'));

    const card = page.getByTestId('image-card').first();
    await expect(card).toBeVisible();
    await expect(card.getByTestId('preview')).toBeVisible();

    // 元数据分组里必须能看到 GPS 与设备型号
    const meta = card.getByTestId('meta-groups');
    await expect(meta).toBeVisible();
    await expect(meta).toContainText('位置信息');
    await expect(meta).toContainText('GPS 纬度');
    await expect(meta).toContainText('设备型号');
    await expect(meta).toContainText('拍摄时间');

    // GPS 高敏感提示
    await expect(card).toContainText('这张图片带有 GPS 坐标');

    // 清理
    await card.getByTestId('clean-button').click();
    const verify = card.getByTestId('verify-ok');
    await expect(verify).toBeVisible({ timeout: 30_000 });
    await expect(verify).toContainText('清理完成');
    await expect(verify).toContainText('无任何可移除数据块');

    // 前后对比
    const compare = card.getByTestId('compare');
    await expect(compare).toBeVisible();
    await expect(compare).toContainText('文件大小');
    await expect(compare).toContainText('像素尺寸');
    await expect(compare).toContainText('640×480');

    // 清理前的字段表格应收起（不再以「当前状态」呈现），改为可回看的历史记录
    await expect(card.getByTestId('meta-cleared')).toBeVisible();
    await expect(card.getByTestId('meta-groups')).toHaveCount(0);
    await expect(card.getByTestId('meta-cleared')).toContainText('已全部移除');

    // 下载：拦截 download 事件，检查文件名与大小
    const downloadPromise = page.waitForEvent('download');
    await card.getByTestId('download-button').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('with-exif-gps.cleaned.jpg');
    const path = await download.path();
    expect(path).toBeTruthy();

    // 全程不应该有外部请求
    expect(externalRequests).toEqual([]);
  });

  test('不支持的文件显示可理解的错误，而不是崩溃', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('file-input').setInputFiles(fixture('not-an-image.txt'));
    const card = page.getByTestId('image-card').first();
    await expect(card).toContainText('无法处理这张图片');
    await expect(card).toContainText('无法识别的文件格式');
  });

  test('损坏文件被标记为结构不完整', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('file-input').setInputFiles(fixture('corrupt-truncated.jpg'));
    const card = page.getByTestId('image-card').first();
    await expect(card).toContainText('文件结构可能已损坏');
  });

  test('批量：多张图片 + 一键清理 + 打包下载 + 清空工作区', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('file-input').setInputFiles([
      fixture('with-exif-gps.jpg'),
      fixture('transparent-with-text.png'),
      fixture('with-exif.webp'),
    ]);
    await expect(page.getByTestId('image-card')).toHaveCount(3);

    await page.getByRole('button', { name: /一键清理全部/ }).click();

    await expect(page.getByTestId('verify-ok')).toHaveCount(3, { timeout: 60_000 });

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: /打包下载/ }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^ghostpixel-\d{4}-\d{2}-\d{2}\.zip$/);

    await page.getByRole('button', { name: /清空工作区/ }).first().click();
    await expect(page.getByTestId('image-card')).toHaveCount(0);
    await expect(page.getByText('还没有图片')).toBeVisible();
  });

  test('主题切换：浅色 / 深色都会改变页面背景', async ({ page }) => {
    await page.goto('/');
    const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const initial = await bg();

    const themeBtn = page.getByRole('button', { name: /切换主题/ });
    // 循环直到切到与初始不同的主题
    let changed = false;
    for (let i = 0; i < 3; i++) {
      await themeBtn.click();
      const now = await bg();
      if (now !== initial) {
        changed = true;
        break;
      }
    }
    expect(changed).toBe(true);
  });

  test('键盘可达：Tab 能聚焦到上传区域并触发文件选择', async ({ page }) => {
    await page.goto('/');
    const dropzone = page.getByTestId('dropzone');
    await expect(dropzone).toBeVisible();
    await dropzone.focus();
    await expect(dropzone).toBeFocused();
    // Enter 键应该触发隐藏 input 的 click
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.keyboard.press('Enter');
    const chooser = await fileChooserPromise;
    expect(chooser).toBeTruthy();
  });
});
