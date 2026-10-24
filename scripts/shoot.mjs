/**
 * 生成 README 用的真实截图（不是示意图，全部来自实际渲染）。
 * 用法： node scripts/shoot.mjs   （需先跑过 vite build，或用 preview-for-e2e 起服务）
 */
import { chromium, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const shots = join(root, 'docs', 'screenshots');
mkdirSync(shots, { recursive: true });

const BASE = process.env.SHOT_BASE ?? 'http://127.0.0.1:4399/';
const fixture = (n) => join(root, 'public', 'fixtures', n);

const browser = await chromium.launch();

async function desktopShots() {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });

  await page.screenshot({ path: join(shots, '01-empty-state.png') });

  await page.getByTestId('file-input').setInputFiles([fixture('with-exif-gps.jpg')]);
  // 等元数据表出现
  await page.getByTestId('meta-groups').waitFor({ timeout: 20000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(shots, '02-metadata-detected.png') });

  // 只截当前卡片，做一张更聚焦的图
  await page.getByTestId('image-card').first().screenshot({ path: join(shots, '03-card-metadata.png') });

  await page.getByTestId('clean-button').first().click();
  await page.getByTestId('verify-ok').first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(500);
  await page.getByTestId('image-card').first().screenshot({ path: join(shots, '04-card-verified.png') });

  // 批量 + 前后对比
  await page.getByTestId('file-input').setInputFiles([
    fixture('transparent-with-text.png'),
    fixture('with-exif.webp'),
    fixture('animated-comment.gif'),
  ]);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: join(shots, '05-batch-toolbar.png'), clip: { x: 0, y: 0, width: 1280, height: 520 } });

  // 深色模式
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(shots, '06-dark-mode.png') });

  await ctx.close();
}

async function mobileShots() {
  const ctx = await browser.newContext({ ...devices['iPhone 13'], deviceScaleFactor: 3 });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.screenshot({ path: join(shots, '07-mobile-home.png') });

  await page.getByTestId('file-input').setInputFiles([fixture('with-exif-gps.jpg')]);
  await page.getByTestId('meta-groups').waitFor({ timeout: 20000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(shots, '08-mobile-metadata.png'), fullPage: false });

  await page.getByTestId('clean-button').first().click();
  await page.getByTestId('verify-ok').first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(shots, '09-mobile-verified.png') });

  await ctx.close();
}

await desktopShots();
await mobileShots();
await browser.close();
console.log('screenshots ->', shots);
