import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectFormat, scanContainer, stripContainer, isContainerClean } from '../../src/lib/containers.ts';
import { analyzeBytes } from '../../src/lib/pipeline.ts';
import { readPngTextEntries } from '../../src/lib/parse.ts';

const FIX = join(process.cwd(), 'public', 'fixtures');
const read = (name: string) => new Uint8Array(readFileSync(join(FIX, name)));

describe('格式识别', () => {
  it('按魔数识别常见格式', () => {
    expect(detectFormat(read('with-exif-gps.jpg'))).toBe('jpeg');
    expect(detectFormat(read('clean.png'))).toBe('png');
    expect(detectFormat(read('with-exif.webp'))).toBe('webp');
    expect(detectFormat(read('animated-comment.gif'))).toBe('gif');
  });

  it('非图片文件识别为 unknown', () => {
    expect(detectFormat(read('not-an-image.txt'))).toBe('unknown');
  });
});

describe('JPEG 容器扫描', () => {
  it('找到 EXIF APP1 与注释块，并保留像素数据', () => {
    const scan = scanContainer(read('with-exif-gps.jpg'));
    expect(scan.kind).toBe('jpeg');
    expect(scan.width).toBe(640);
    expect(scan.height).toBe(480);
    expect(scan.supportsLosslessStrip).toBe(true);
    const ids = scan.segments.map((s) => s.id);
    expect(ids).toContain('APP1');
    expect(ids).toContain('COM');
    expect(ids).toContain('SCAN');
    expect(scan.metadataCount).toBeGreaterThanOrEqual(2);
    expect(scan.metadataBytes).toBeGreaterThan(0);
  });

  it('APPO(JFIF) 与量化表被保留', () => {
    const scan = scanContainer(read('with-exif-gps.jpg'));
    const app0 = scan.segments.find((s) => s.id === 'APP0');
    expect(app0?.action).toBe('keep');
    expect(scan.segments.filter((s) => s.id === 'DQT').every((s) => s.action === 'keep')).toBe(true);
  });

  it('剥离后不再含可移除块，且尺寸不变', () => {
    const bytes = read('with-exif-gps.jpg');
    const scan = scanContainer(bytes);
    const { bytes: out, removed } = stripContainer(bytes, scan);
    expect(removed.length).toBe(scan.metadataCount);

    const outScan = scanContainer(out);
    expect(isContainerClean(outScan)).toBe(true);
    expect(outScan.width).toBe(640);
    expect(outScan.height).toBe(480);
    expect(outScan.segments.some((s) => s.id === 'APP1')).toBe(false);
    expect(out.byteLength).toBeLessThan(bytes.byteLength);
  });

  it('保留 ICC 时 APP2 不被移除', () => {
    const bytes = read('with-icc.jpg');
    const withIcc = scanContainer(bytes, { keepIcc: true });
    const app2 = withIcc.segments.find((s) => s.id === 'APP2');
    expect(app2?.action).toBe('keep');

    const withoutIcc = scanContainer(bytes, { keepIcc: false });
    expect(withoutIcc.metadataCount).toBeGreaterThanOrEqual(withIcc.metadataCount + (app2 ? 1 : 0));
  });

  it('截断文件被标记为不完整', () => {
    const scan = scanContainer(read('corrupt-truncated.jpg'));
    expect(scan.truncated).toBe(true);
    expect(scan.warnings.length).toBeGreaterThan(0);
  });
});

describe('PNG 容器扫描', () => {
  it('识别 tEXt / iTXt 文本块', () => {
    const bytes = read('transparent-with-text.png');
    const scan = scanContainer(bytes);
    expect(scan.kind).toBe('png');
    expect(scan.width).toBe(512);
    const ids = scan.segments.map((s) => s.id);
    expect(ids).toContain('tEXt');
    expect(ids).toContain('iTXt');
    expect(scan.metadataCount).toBeGreaterThanOrEqual(3);
  });

  it('文本块内容可被读出', () => {
    const entries = readPngTextEntries(read('transparent-with-text.png'));
    const author = entries.find((e) => e.keyword === 'Author');
    expect(author?.text).toContain('Ada Lovelace');
  });

  it('剥离后签名与 IHDR/IDAT/IEND 完整', () => {
    const bytes = read('transparent-with-text.png');
    const scan = scanContainer(bytes);
    const { bytes: out } = stripContainer(bytes, scan);
    expect(Array.from(out.subarray(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const outScan = scanContainer(out);
    expect(outScan.segments.map((s) => s.id)).toEqual(expect.arrayContaining(['IHDR', 'IDAT', 'IEND']));
    expect(isContainerClean(outScan)).toBe(true);
    expect(readPngTextEntries(out).length).toBe(0);
  });

  it('IEND 之后附加数据被识别并移除', () => {
    const bytes = read('clean.png');
    const withTrailing = new Uint8Array(bytes.length + 12);
    withTrailing.set(bytes, 0);
    withTrailing.set([...Buffer.from('HIDDEN-DATA!')], bytes.length);
    const scan = scanContainer(withTrailing);
    expect(scan.trailingBytes).toBe(12);
    const { bytes: out } = stripContainer(withTrailing, scan);
    expect(out.byteLength).toBe(bytes.byteLength);
    expect(scanContainer(out).trailingBytes).toBe(0);
  });
});

describe('WebP 容器扫描', () => {
  it('识别 RIFF 结构与 EXIF 块', () => {
    const bytes = read('with-exif.webp');
    const scan = scanContainer(bytes);
    expect(scan.kind).toBe('webp');
    expect(scan.segments.some((s) => s.id === 'EXIF' || s.id === 'XMP')).toBe(true);
    expect(scan.width).toBe(640);
  });

  it('剥离后 RIFF 长度字段被修正', () => {
    const bytes = read('with-exif.webp');
    const scan = scanContainer(bytes);
    const { bytes: out } = stripContainer(bytes, scan);
    const dv = new DataView(out.buffer, out.byteOffset, out.byteLength);
    const riffSize = dv.getUint32(4, true);
    expect(riffSize + 8).toBe(out.byteLength);
    expect(String.fromCharCode(...out.subarray(0, 4))).toBe('RIFF');
    expect(String.fromCharCode(...out.subarray(8, 12))).toBe('WEBP');
    const outScan = scanContainer(out);
    expect(outScan.metadataCount).toBe(0);
  });
});

describe('GIF 容器扫描', () => {
  it('识别注释扩展块', () => {
    const bytes = read('animated-comment.gif');
    const scan = scanContainer(bytes);
    expect(scan.kind).toBe('gif');
    expect(scan.segments.some((s) => s.id === 'COMMENT')).toBe(true);
  });

  it('剥离后结构完整', () => {
    const bytes = read('animated-comment.gif');
    const scan = scanContainer(bytes);
    const { bytes: out } = stripContainer(bytes, scan);
    expect(String.fromCharCode(...out.subarray(0, 3))).toBe('GIF');
    const outScan = scanContainer(out);
    expect(outScan.segments.some((s) => s.id === 'COMMENT')).toBe(false);
    expect(outScan.truncated).toBe(false);
  });
});

describe('不支持的格式', () => {
  it('unknown 不做无损剥离', () => {
    const scan = scanContainer(read('not-an-image.txt'));
    expect(scan.kind).toBe('unknown');
    expect(scan.supportsLosslessStrip).toBe(false);
    expect(scan.warnings.length).toBeGreaterThan(0);
  });

  it('伪造 PNG 魔数被识别但结构损坏', () => {
    const scan = scanContainer(read('fake-png.png'));
    expect(scan.kind).toBe('png');
    expect(scan.truncated || scan.warnings.length > 0).toBe(true);
  });
});

describe('解析流水线', () => {
  it('从 JSON 报告里能读出 GPS 与设备信息', async () => {
    const { report } = await analyzeBytes(read('with-exif-gps.jpg'));
    expect(report.parsed).toBe(true);
    const keys = report.groups.flatMap((g) => g.fields.map((f) => f.label));
    expect(keys).toEqual(expect.arrayContaining(['设备型号', '拍摄时间']));
    expect(report.hasGps).toBe(true);
    expect(report.gps?.latitude).toBeCloseTo(39.9, 1);
    expect(report.gps?.longitude).toBeCloseTo(116.38, 1);
    expect(report.highSensitiveCount).toBeGreaterThan(0);
  });

  it('无元数据图片的字段数为 0 或很少', async () => {
    const { report } = await analyzeBytes(read('no-metadata.jpg'));
    const labels = report.groups.flatMap((g) => g.fields.map((f) => f.label));
    expect(labels).not.toContain('GPS 纬度');
    expect(labels).not.toContain('设备型号');
  });

  it('PNG 文本字段出现在报告里', async () => {
    const { report } = await analyzeBytes(read('transparent-with-text.png'));
    const labels = report.groups.flatMap((g) => g.fields.map((f) => f.label));
    expect(labels.some((l) => l.includes('PNG 作者'))).toBe(true);
    expect(labels.some((l) => l.includes('XMP'))).toBe(true);
  });
});
