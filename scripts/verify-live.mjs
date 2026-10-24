/**
 * 线上验收：直接对生产 URL 跑一遍核心流程，确认部署的构建产物真的可用
 * （而不只是「HTTP 200」）。
 *
 * 用法： node scripts/verify-live.mjs [url]
 */
import { chromium, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const LIVE = process.argv[2] ?? 'https://iiiiiiiiiiiiiKK.github.io/ghostpixel/';
const outDir = join(root, 'docs', 'screenshots');
mkdirSync(outDir, { recursive: true });

const fx = (n) => join(root, 'public', 'fixtures', n);
const results = [];
const record = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? '✔' : '✘'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch();

/* ---------- 桌面：核心流程 ---------- */
{
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const external = [];
  page.on('request', (r) => {
    const u = r.url();
    const origin = new URL(LIVE).origin;
    if (!u.startsWith(origin) && !u.startsWith('blob:') && !u.startsWith('data:')) external.push(u);
  });

  const resp = await page.goto(LIVE, { waitUntil: 'networkidle', timeout: 60000 });
  record('线上首页可访问', resp?.status() === 200, `HTTP ${resp?.status()}`);
  record('页面标题正确', (await page.title()).includes('GhostPixel'), await page.title());

  const x = page.getByTestId('x-link');
  record('顶栏 𝕏 入口存在', await x.count() === 1);
  record('𝕏 链接指向 0xkillcoin', (await x.getAttribute('href')) === 'https://x.com/0xkillcoin');
  record('𝕏 入口可见', await x.isVisible());

  await page.getByTestId('file-input').setInputFiles(fx('with-exif-gps.jpg'));
  await page.getByTestId('meta-groups').waitFor({ timeout: 30000 });
  const metaText = await page.getByTestId('meta-groups').innerText();
  record('检测到 GPS 纬度', metaText.includes('GPS 纬度'));
  record('检测到设备型号', metaText.includes('设备型号'));
  record('检测到拍摄时间', metaText.includes('拍摄时间'));
  record('GPS 红色提示出现', (await page.locator('.alert--danger').count()) > 0);

  await page.screenshot({ path: join(outDir, '10-live-desktop-metadata.png') });

  await page.getByTestId('clean-button').first().click();
  await page.getByTestId('verify-ok').first().waitFor({ timeout: 30000 });
  const verifyText = await page.getByTestId('verify-ok').innerText();
  record('复检验证通过', verifyText.includes('清理完成'));
  record('导出容器无残留块', verifyText.includes('无任何可移除数据块'));
  record('残留字段为 0', /残留字段\s*0\s*个/.test(verifyText.replace(/\n/g, ' ')));

  const dl = page.waitForEvent('download');
  await page.getByTestId('download-button').first().click();
  const download = await dl;
  const p = await download.path();
  const size = p ? (await import('node:fs')).statSync(p).size : 0;
  record('可下载清理后的图片', !!p && size > 0, `${download.suggestedFilename()} (${size} bytes)`);

  await page.getByTestId('image-card').first().screenshot({ path: join(outDir, '11-live-desktop-verified.png') });

  record('全程无外部网络请求', external.length === 0, external.join(', ') || '0 requests');
  await ctx.close();
}

/* ---------- 移动端：iPhone 视口 ---------- */
{
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await ctx.newPage();
  await page.goto(LIVE, { waitUntil: 'networkidle', timeout: 60000 });

  const overflow = await page.evaluate(() => ({
    s: document.documentElement.scrollWidth,
    c: document.documentElement.clientWidth,
  }));
  record('iPhone 视口无横向溢出', overflow.s <= overflow.c + 1, `${overflow.s} <= ${overflow.c}`);

  const x = page.getByTestId('x-link');
  const box = await x.boundingBox();
  record('移动端 𝕏 入口可见且可点', !!box && box.width >= 30 && box.height >= 30, box ? `${Math.round(box.width)}×${Math.round(box.height)}` : 'null');

  await page.getByTestId('file-input').setInputFiles(fx('transparent-with-text.png'));
  await page.getByTestId('meta-groups').waitFor({ timeout: 30000 });
  await page.screenshot({ path: join(outDir, '12-live-mobile-metadata.png') });

  await page.getByTestId('clean-button').first().click();
  await page.getByTestId('verify-ok').first().waitFor({ timeout: 30000 });
  record('移动端清理成功', true);

  const overflow2 = await page.evaluate(() => ({
    s: document.documentElement.scrollWidth,
    c: document.documentElement.clientWidth,
  }));
  record('移动端处理后仍无溢出', overflow2.s <= overflow2.c + 1, `${overflow2.s} <= ${overflow2.c}`);
  await page.screenshot({ path: join(outDir, '13-live-mobile-verified.png') });
  await ctx.close();
}

await browser.close();

const failed = results.filter((r) => !r.pass);
writeFileSync(join(root, 'docs', 'live-verification.json'), JSON.stringify(results, null, 2));
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log('FAILED:', failed.map((f) => f.name).join(' | '));
  process.exit(1);
}
