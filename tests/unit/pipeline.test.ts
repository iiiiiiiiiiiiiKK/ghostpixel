import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scanContainer, stripContainer, isContainerClean } from '../../src/lib/containers.ts';
import { analyzeBytes } from '../../src/lib/pipeline.ts';
import { parseMetadata } from '../../src/lib/parse.ts';
import { buildMetadataReport, reportKeys } from '../../src/lib/fields.ts';

const FIX = join(process.cwd(), 'public', 'fixtures');
const OUT = join(process.cwd(), 'tmp-cleaned');
const read = (name: string) => new Uint8Array(readFileSync(join(FIX, name)));

/** 走一遍「扫描 → 剥离 → 重新扫描 → 重新解析」，返回清理前后的字段集合。 */
async function roundTrip(name: string) {
  const bytes = read(name);
  const scan = scanContainer(bytes);
  const before = await parseMetadata(bytes, scan);
  const { bytes: out } = stripContainer(bytes, scan);
  const outScan = scanContainer(out);
  const after = await parseMetadata(out, outScan);
  return { bytes, out, scan, outScan, before, after };
}

describe('清理闭环：JPEG', () => {
  it('EXIF / GPS / 设备信息在导出文件中确实消失', async () => {
    const { out, before, after, outScan } = await roundTrip('with-exif-gps.jpg');

    const beforeKeys = reportKeys(before.report);
    const afterKeys = new Set(reportKeys(after.report));

    expect(beforeKeys.length).toBeGreaterThan(5);
    for (const k of beforeKeys) expect(afterKeys.has(k)).toBe(false);

    expect(after.report.hasGps).toBe(false);
    expect(after.report.fieldCount).toBe(0);
    expect(afterKeys.size).toBe(0);

    // 结构验证：导出文件依然是一个完整的 JPEG，且尺寸未变。
    expect(outScan.kind).toBe('jpeg');
    expect(outScan.truncated).toBe(false);
    expect(outScan.width).toBe(640);
    expect(outScan.height).toBe(480);
    expect(isContainerClean(outScan)).toBe(true);
    expect(out.byteLength).toBeLessThan(before.report ? read('with-exif-gps.jpg').byteLength : Infinity);
  });

  it('像素数据在剥离前后完全一致（真正无损）', () => {
    const bytes = read('with-exif-gps.jpg');
    const scan = scanContainer(bytes);
    const scanSeg = scan.segments.find((s) => s.id === 'SCAN')!;
    const { bytes: out } = stripContainer(bytes, scan);
    const outScan = scanContainer(out);
    const outScanSeg = outScan.segments.find((s) => s.id === 'SCAN')!;
    const originalPixels = bytes.subarray(scanSeg.offset + (scanSeg.offset ? 0 : 0), scanSeg.offset + scanSeg.size);
    const outPixels = out.subarray(outScanSeg.offset, outScanSeg.offset + outScanSeg.size);
    expect(outPixels.byteLength).toBe(originalPixels.byteLength);
    expect(Buffer.from(outPixels).equals(Buffer.from(originalPixels))).toBe(true);
  });
});

describe('清理闭环：PNG', () => {
  it('文本块与 XMP 在导出文件中消失，透明度结构保留', async () => {
    const { out, before, after, outScan } = await roundTrip('transparent-with-text.png');
    expect(before.report.fieldCount).toBeGreaterThanOrEqual(3);
    expect(after.report.fieldCount).toBe(0);
    expect(outScan.segments.some((s) => s.id === 'tEXt' || s.id === 'iTXt')).toBe(false);
    // tRNS 或 16 位 alpha 决定了透明信息，剥离元数据不应影响它。
    expect(outScan.width).toBe(512);
    expect(outScan.height).toBe(512);
    expect(isContainerClean(outScan)).toBe(true);
    expect(out.byteLength).toBeLessThan(read('transparent-with-text.png').byteLength);
  });
});

describe('清理闭环：WebP / GIF', () => {
  it('WebP 的 EXIF 块被移除且 RIFF 结构自洽', async () => {
    const { out, outScan } = await roundTrip('with-exif.webp');
    expect(outScan.metadataCount).toBe(0);
    const riff = new DataView(out.buffer, out.byteOffset, out.byteLength).getUint32(4, true);
    expect(riff + 8).toBe(out.byteLength);
    expect(outScan.width).toBe(640);
  });

  it('GIF 注释被移除，帧数据完整', async () => {
    const { outScan } = await roundTrip('animated-comment.gif');
    expect(outScan.segments.some((s) => s.id === 'COMMENT')).toBe(false);
    expect(outScan.truncated).toBe(false);
    expect(outScan.width).toBe(640);
  });
});

describe('已干净的图片', () => {
  it('清理干净图片不会破坏它', async () => {
    const { out, outScan } = await roundTrip('clean.png');
    expect(outScan.kind).toBe('png');
    expect(outScan.truncated).toBe(false);
    expect(outScan.width).toBe(640);
    // 没有可移除块时，输出应与输入等价（至少仍有完整 IHDR/IDAT/IEND）。
    expect(outScan.segments.map((s) => s.id)).toEqual(expect.arrayContaining(['IHDR', 'IDAT', 'IEND']));
    expect(out.byteLength).toBe(read('clean.png').byteLength);
  });
});

describe('报告结构', () => {
  it('buildMetadataReport 跳过嵌套壳层，只保留叶子字段', () => {
    const report = buildMetadataReport({
      Make: 'GhostPhone',
      gps: { latitude: 39.9, longitude: 116.38 },
      exif: { DateTimeOriginal: new Date('2024-08-14T21:07:33Z') },
    });
    const keys = reportKeys(report);
    expect(keys).toContain('Make');
    expect(keys).toContain('gps.latitude');
    expect(keys).toContain('exif.DateTimeOriginal');
    expect(keys).not.toContain('exif');
    expect(report.fieldCount).toBe(4);
    expect(report.hasGps).toBe(true);
  });
});

describe('生成可外部验证的导出文件', () => {
  it('把清理结果写到 tmp-cleaned/，供 Pillow 二次校验', async () => {
    mkdirSync(OUT, { recursive: true });
    for (const name of ['with-exif-gps.jpg', 'transparent-with-text.png', 'with-exif.webp', 'animated-comment.gif']) {
      const { out } = await roundTrip(name);
      const ext = name.slice(name.lastIndexOf('.'));
      writeFileSync(join(OUT, name.replace(ext, `-cleaned${ext}`)), out);
    }
    const analysis = await analyzeBytes(read('with-exif-gps.jpg'));
    expect(analysis.report.hasGps).toBe(true);
  });
});
