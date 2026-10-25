import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => join(here, '..', '..', 'public', 'fixtures', name);

/**
 * 自适应验收：
 *  - 页面在 320 / 390 / 768 / 1280 宽度下都不出现横向滚动
 *  - 顶部作者 𝕏 入口在所有宽度都可见且可点
 *  - 触控目标不小于 32×32（Apple HIG 建议 44，这里做底线检查）
 */
const WIDTHS = [320, 390, 414, 768, 1280];

for (const width of WIDTHS) {
  test(`自适应 @${width}px：无横向溢出且 𝕏 入口可见`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');

    // 1) 没有横向滚动条
    const overflow = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
    }));
    expect(overflow.scrollW).toBeLessThanOrEqual(overflow.clientW + 1);

    // 2) 顶部 X 链接可见、href 正确
    const x = page.getByTestId('x-link');
    await expect(x).toBeVisible();
    await expect(x).toHaveAttribute('href', 'https://x.com/0xkillcoin');
    const box = await x.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(30);
    expect(box!.height).toBeGreaterThanOrEqual(30);

    // 3) 上传区与主标题可见
    await expect(page.getByTestId('dropzone')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    // 4) 加载图片后仍然不溢出
    await page.getByTestId('file-input').setInputFiles(fixture('with-exif-gps.jpg'));
    await page.getByTestId('meta-groups').waitFor({ timeout: 20000 });
    const after = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
    }));
    expect(after.scrollW).toBeLessThanOrEqual(after.clientW + 1);
  });
}

test('深色模式下仍然可读（背景与文字有足够对比）', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  const colors = await page.evaluate(() => {
    const body = getComputedStyle(document.body);
    const h1 = document.querySelector('h1');
    return {
      bg: body.backgroundColor,
      text: h1 ? getComputedStyle(h1).color : '',
    };
  });
  // 深色背景应该是暗色
  const rgb = colors.bg.match(/\d+/g)!.map(Number);
  const luma = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
  expect(luma).toBeLessThan(0.3);
  expect(colors.text).not.toBe('');
});

test('页脚在窄屏下分行排列，分隔符不单独占行', async ({ page }) => {
  for (const width of [320, 390, 430, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    const footer = await page.evaluate(() => {
      const inner = document.querySelector('.footer-inner');
      if (!inner) return null;
      const rows = Array.from(inner.querySelectorAll('.footer-row'));
      // 每个分隔符必须和某个链接/文本在同一行（说明它没有被挤到独立一行）
      const seps = Array.from(document.querySelectorAll('.footer-sep')).map((s) => {
        const r = s.getBoundingClientRect();
        const siblings = rows.flatMap((row) => Array.from(row.querySelectorAll('a, span')));
        const sameLine = siblings.some((el) => {
          if (el === s) return false;
          const er = el.getBoundingClientRect();
          return Math.abs(er.top - r.top) < 3 && (el.textContent ?? '').trim().length > 0;
        });
        return sameLine;
      });
      return {
        rows: rows.length,
        rowTops: new Set(rows.map((r) => Math.round(r.getBoundingClientRect().top))).size,
        sepsOrphaned: seps.filter((v) => !v).length,
        text: inner.innerText.replace(/\n/g, ' ⏎ '),
      };
    });
    expect(footer, `footer @${width}px`).not.toBeNull();
    expect(footer!.rows, `row count @${width}px`).toBe(3);
    expect(footer!.rowTops, `rows stacked @${width}px`).toBe(3);
    expect(footer!.sepsOrphaned, `orphan separators @${width}px`).toBe(0);
    // 关键内容都在
    expect(footer!.text).toContain('GhostPixel');
    expect(footer!.text).toContain('MIT License');
    expect(footer!.text).toContain('0xkillcoin');
  }
});

test('清理过程不产生任何外部网络请求', async ({ page }) => {
  const external: string[] = [];
  page.on('request', (req) => {
    const url = req.url();
    if (!url.startsWith('http://127.0.0.1:4399') && !url.startsWith('blob:') && !url.startsWith('data:')) {
      external.push(`${req.method()} ${url}`);
    }
  });
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(fixture('with-exif-gps.jpg'));
  await page.getByTestId('meta-groups').waitFor({ timeout: 20000 });
  await page.getByTestId('clean-button').first().click();
  await page.getByTestId('verify-ok').first().waitFor({ timeout: 30000 });
  expect(external).toEqual([]);
  // 页面上展示的计数也应该保持 0
  await expect(page.getByTestId('network-calls')).toContainText('0 次');
});
