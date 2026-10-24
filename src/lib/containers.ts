/**
 * 容器层解析与重写。
 *
 * 这里的核心思路：绝大多数图片格式的元数据都存放在与像素数据相互独立的「块」里。
 * 只要精确识别这些块，就能在不重新编码像素的前提下把元数据整块移除，
 * 从而同时满足「彻底」和「无损」两个要求，也避免 Canvas 重编码带来的画质损失。
 *
 * 但这不是万能的：块内部的私有数据、像素级隐写、以及本工具不认识的格式，
 * 都无法用这种方式处理，因此扫描结果会明确区分「可移除」「保留」「需要重编码」。
 */
import { ascii, concat, copySlice, findAllMarkers, u16be, u16le, u24le, u32be, u32le, writeU32be, writeU32le } from './bytes.ts';
import type { ContainerScan, MetaSegment, ScanKind, StripAction } from './types.ts';

export interface ScanOptions {
  /** 是否保留 ICC 色彩配置（默认移除，因为 ICC 里可能带有设备/软件描述）。 */
  keepIcc?: boolean;
  /** 是否保留 EXIF 中的 Orientation（默认不保留，整段移除）。 */
  keepOrientation?: boolean;
}

const DEFAULT_OPTS: Required<ScanOptions> = { keepIcc: false, keepOrientation: false };

export const FORMAT_LABEL: Record<ScanKind, string> = {
  jpeg: 'JPEG',
  png: 'PNG',
  webp: 'WebP',
  gif: 'GIF',
  bmp: 'BMP',
  avif: 'AVIF',
  heic: 'HEIC/HEIF',
  tiff: 'TIFF',
  ico: 'ICO',
  unknown: '未知',
};

export const FORMAT_MIME: Record<ScanKind, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  avif: 'image/avif',
  heic: 'image/heic',
  tiff: 'image/tiff',
  ico: 'image/x-icon',
  unknown: 'application/octet-stream',
};

/** 通过魔数判断格式。只看头部字节，不做全文件扫描。 */
export function detectFormat(b: Uint8Array): ScanKind {
  if (b.length < 4) return 'unknown';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b[0] === 0x89 && ascii(b, 1, 3) === 'PNG' && b[4] === 0x0d && b[5] === 0x0a) return 'png';
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return 'webp';
  if (ascii(b, 0, 4) === 'GIF8') return 'gif';
  if (ascii(b, 0, 2) === 'BM') return 'bmp';
  if (ascii(b, 4, 4) === 'ftyp') {
    const brand = ascii(b, 8, 4).toLowerCase();
    if (brand.includes('avif') || brand.includes('avis')) return 'avif';
    if (brand.includes('heic') || brand.includes('heix') || brand.includes('mif1') || brand.includes('hevc')) return 'heic';
    return 'unknown';
  }
  if (b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a && b[3] === 0x00) return 'tiff';
  if (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0x00 && b[3] === 0x2a) return 'tiff';
  if (b[0] === 0x00 && b[1] === 0x00 && b[2] === 0x01 && b[3] === 0x00) return 'ico';
  return 'unknown';
}

function emptyScan(kind: ScanKind, warnings: string[] = [], truncated = false): ContainerScan {
  return {
    kind,
    label: FORMAT_LABEL[kind],
    mime: FORMAT_MIME[kind],
    segments: [],
    metadataCount: 0,
    metadataBytes: 0,
    trailingBytes: 0,
    supportsLosslessStrip: false,
    warnings,
    truncated,
  };
}

function finalize(scan: ContainerScan): ContainerScan {
  let count = 0;
  let bytes = 0;
  for (const s of scan.segments) {
    if (s.action === 'strip') {
      count++;
      bytes += s.size;
    }
  }
  scan.metadataCount = count;
  scan.metadataBytes = bytes;
  return scan;
}

/* ------------------------------------------------------------------ *
 * JPEG
 * ------------------------------------------------------------------ */

const JPEG_APP_LABEL: Record<number, string> = {
  0xe0: 'APP0 · JFIF',
  0xe1: 'APP1 · EXIF / XMP',
  0xe2: 'APP2 · ICC 色彩配置',
  0xe3: 'APP3 · 私有数据',
  0xe4: 'APP4 · 私有数据',
  0xe5: 'APP5 · 私有数据',
  0xe6: 'APP6 · 私有数据',
  0xe7: 'APP7 · 私有数据',
  0xe8: 'APP8 · 私有数据',
  0xe9: 'APP9 · 私有数据',
  0xea: 'APP10 · 私有数据',
  0xeb: 'APP11 · JUMBF / 私有数据',
  0xec: 'APP12 · Ducky / 厂商数据',
  0xed: 'APP13 · IPTC / Photoshop',
  0xee: 'APP14 · Adobe 色彩变换',
  0xef: 'APP15 · 厂商数据',
};

function jpegSegmentFor(marker: number, offset: number, size: number, opts: Required<ScanOptions>): MetaSegment {
  if (marker === 0xe0) {
    return {
      id: 'APP0',
      label: 'JFIF 头（像素密度）',
      offset,
      size,
      action: 'keep',
      note: '仅包含像素密度 / 宽高比，是渲染所需的头信息，不含拍摄信息。',
      sensitivity: 'none',
    };
  }
  if (marker === 0xe1) {
    return {
      id: 'APP1',
      label: 'EXIF / XMP 元数据',
      offset,
      size,
      action: 'strip',
      note: '包含拍摄时间、设备型号、GPS 坐标、内嵌缩略图等，是隐私泄露的主要来源。',
      sensitivity: 'high',
    };
  }
  if (marker === 0xe2) {
    return {
      id: 'APP2',
      label: 'ICC 色彩配置',
      offset,
      size,
      action: opts.keepIcc ? 'keep' : 'strip',
      note: opts.keepIcc
        ? '已选择保留：颜色显示更准确，但配置文件内可能写入来源设备或软件名称。'
        : '默认移除：色彩可能发生极轻微变化，可关闭清理选项后保留。',
      sensitivity: 'low',
    };
  }
  if (marker === 0xee) {
    return {
      id: 'APP14',
      label: 'Adobe 色彩变换标记',
      offset,
      size,
      action: 'keep',
      note: 'CMYK / YCCK 图片需要该标记才能正确显示颜色，只含色彩变换类型。',
      sensitivity: 'none',
    };
  }
  if (marker === 0xed) {
    return {
      id: 'APP13',
      label: 'IPTC / Photoshop 资源',
      offset,
      size,
      action: 'strip',
      note: '常包含作者、标题、说明、编辑历史等文本信息。',
      sensitivity: 'medium',
    };
  }
  if (marker === 0xfe) {
    return {
      id: 'COM',
      label: 'JPEG 注释',
      offset,
      size,
      action: 'strip',
      note: '自由文本注释，可能包含软件名称或内部备注。',
      sensitivity: 'medium',
    };
  }
  return {
    id: `APP${marker - 0xe0}`,
    label: JPEG_APP_LABEL[marker] ?? `APP${marker - 0xe0}`,
    offset,
    size,
    action: 'strip',
    note: '厂商自定义数据块，可能包含设备、软件或私有信息。',
    sensitivity: 'medium',
  };
}

function sofDimensions(b: Uint8Array, marker: number, segDataStart: number, dataLen: number) {
  // SOF0..SOF15 除去 DHT(C4)、JPG(C8)、DAC(CC)
  if (marker < 0xc0 || marker > 0xcf || marker === 0xc4 || marker === 0xc8 || marker === 0xcc) return null;
  if (dataLen < 5) return null;
  // 段数据布局：精度(1) | 高度(2) | 宽度(2) | 分量数(1) ...
  const h = u16be(b, segDataStart + 1);
  const w = u16be(b, segDataStart + 3);
  if (w > 0 && h > 0) return { width: w, height: h };
  return null;
}

export function scanJpeg(b: Uint8Array, options: ScanOptions = {}): ContainerScan {
  const opts = { ...DEFAULT_OPTS, ...options };
  const scan = emptyScan('jpeg');
  scan.supportsLosslessStrip = true;
  const segments: MetaSegment[] = [];
  let width: number | undefined;
  let height: number | undefined;

  let i = 2; // 跳过 SOI
  let eoiEnd = -1;
  while (i + 1 < b.length) {
    if (b[i] !== 0xff) {
      // 结构损坏：无法继续可靠解析。
      scan.truncated = true;
      scan.warnings.push(`偏移 ${i} 处未找到预期的标记，文件结构可能已损坏。`);
      break;
    }
    let j = i;
    while (j < b.length && b[j] === 0xff) j++;
    if (j >= b.length) {
      scan.truncated = true;
      break;
    }
    const marker = b[j];
    const markerStart = i;

    if (marker === 0xd9) {
      eoiEnd = j + 1;
      break;
    }
    if (marker === 0xda) {
      // SOS：后面紧跟熵编码数据，需要找到下一个真正的标记。
      if (j + 3 >= b.length) {
        scan.truncated = true;
        break;
      }
      const len = u16be(b, j + 1);
      const dataEnd = j + 1 + len;
      if (dataEnd > b.length) {
        scan.truncated = true;
        break;
      }
      let k = dataEnd;
      while (k + 1 < b.length) {
        if (b[k] === 0xff) {
          const next = b[k + 1];
          if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) {
            k += 2;
            continue;
          }
          break;
        }
        k++;
      }
      segments.push({
        id: 'SCAN',
        label: '图像扫描数据',
        offset: markerStart,
        size: Math.min(k, b.length) - markerStart,
        action: 'keep',
        note: '像素数据本身，不包含元数据。',
        sensitivity: 'none',
      });
      i = k;
      continue;
    }
    if (marker >= 0xd0 && marker <= 0xd7) {
      segments.push({
        id: 'RST',
        label: '重启标记',
        offset: markerStart,
        size: 2,
        action: 'keep',
        note: '解码所需的同步标记。',
        sensitivity: 'none',
      });
      i = j + 1;
      continue;
    }
    if (j + 3 > b.length) {
      scan.truncated = true;
      break;
    }
    const len = u16be(b, j + 1);
    if (len < 2) {
      scan.truncated = true;
      scan.warnings.push('标记长度字段非法。');
      break;
    }
    const segEnd = j + 1 + len;
    if (segEnd > b.length) {
      scan.truncated = true;
      scan.warnings.push('文件在元数据块中间被截断。');
      break;
    }
    if (marker >= 0xe0 && marker <= 0xef) {
      segments.push(jpegSegmentFor(marker, markerStart, segEnd - markerStart, opts));
    } else if (marker === 0xfe) {
      segments.push(jpegSegmentFor(marker, markerStart, segEnd - markerStart, opts));
    } else if (marker === 0xdb || marker === 0xc4) {
      segments.push({
        id: marker === 0xdb ? 'DQT' : 'DHT',
        label: marker === 0xdb ? '量化表' : '霍夫曼表',
        offset: markerStart,
        size: segEnd - markerStart,
        action: 'keep',
        note: '解码必需的表数据。',
        sensitivity: 'none',
      });
    } else {
      const dims = sofDimensions(b, marker, j + 3, len - 2);
      if (dims) {
        width = dims.width;
        height = dims.height;
        segments.push({
          id: 'SOF',
          label: '帧头（尺寸信息）',
          offset: markerStart,
          size: segEnd - markerStart,
          action: 'keep',
          note: '记录像素尺寸与采样方式。',
          sensitivity: 'none',
        });
      } else {
        segments.push({
          id: `0x${marker.toString(16).toUpperCase()}`,
          label: `结构标记 0x${marker.toString(16).toUpperCase()}`,
          offset: markerStart,
          size: segEnd - markerStart,
          action: 'keep',
          note: '图像结构所需标记。',
          sensitivity: 'none',
        });
      }
    }
    i = segEnd;
  }

  if (eoiEnd < 0) {
    scan.truncated = true;
    scan.warnings.push('未找到 JPEG 结束标记 (EOI)，文件可能不完整。');
  }
  if (eoiEnd >= 0 && eoiEnd < b.length) {
    scan.trailingBytes = b.length - eoiEnd;
    segments.push({
      id: 'TRAILING',
      label: '结束标记之后的多余数据',
      offset: eoiEnd,
      size: scan.trailingBytes,
      action: 'strip',
      note: '正常图片在 EOI 之后不应有数据，附加内容可能隐藏额外信息。',
      sensitivity: 'medium',
    });
  }

  if (!width || !height) {
    const marker = findAllMarkers(b, ['\x00\x00\x00\x00'], 64);
    void marker;
  }

  scan.segments = segments;
  scan.width = width;
  scan.height = height;
  if (width === undefined) scan.warnings.push('未能从帧头读取像素尺寸。');
  return finalize(scan);
}

/* ------------------------------------------------------------------ *
 * PNG
 * ------------------------------------------------------------------ */

const PNG_TEXT_CHUNKS = new Set(['tEXt', 'zTXt', 'iTXt']);
const PNG_EXIF_CHUNKS = new Set(['eXIf']);
const PNG_TIME_CHUNKS = new Set(['tIME']);
const PNG_KEEP_STRUCTURAL = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'gAMA', 'cHRM', 'sRGB', 'sBIT', 'bKGD', 'hIST', 'sPLT', 'pHYs', 'acTL', 'fcTL', 'fdAT']);
const PNG_ICC = 'iCCP';

interface PngChunk {
  type: string;
  start: number;
  end: number; // 含 CRC
  dataStart: number;
  dataLen: number;
}

function readPngChunks(b: Uint8Array): { chunks: PngChunk[]; truncated: boolean; endAfterIend: number } {
  const chunks: PngChunk[] = [];
  let o = 8;
  let truncated = false;
  let endAfterIend = -1;
  let guard = 0;
  while (o + 8 <= b.length && guard++ < 100_000) {
    const len = u32be(b, o);
    const type = ascii(b, o + 4, 4);
    // 合法的块类型只由 ASCII 字母组成；否则说明结构已经损坏。
    if (!/^[A-Za-z]{4}$/.test(type)) {
      truncated = true;
      break;
    }
    const dataStart = o + 8;
    const end = dataStart + len + 4;
    if (len > 0x7fffffff || end > b.length) {
      truncated = true;
      break;
    }
    chunks.push({ type, start: o, end, dataStart, dataLen: len });
    o = end;
    if (type === 'IEND') {
      endAfterIend = end;
      break;
    }
  }
  return { chunks, truncated, endAfterIend };
}

export function scanPng(b: Uint8Array, options: ScanOptions = {}): ContainerScan {
  const opts = { ...DEFAULT_OPTS, ...options };
  const scan = emptyScan('png');
  scan.supportsLosslessStrip = true;
  const { chunks, truncated, endAfterIend } = readPngChunks(b);
  scan.truncated = truncated;
  if (truncated) scan.warnings.push('PNG 数据块结构不完整，文件可能被截断。');
  if (chunks.length === 0) {
    scan.warnings.push('未能解析出任何 PNG 数据块。');
    return finalize(scan);
  }

  const segments: MetaSegment[] = [];
  for (const c of chunks) {
    const size = c.end - c.start;
    if (c.type === 'IHDR') {
      if (c.dataLen >= 8) {
        scan.width = u32be(b, c.dataStart);
        scan.height = u32be(b, c.dataStart + 4);
      }
      segments.push({ id: 'IHDR', label: '图像头（尺寸 / 位深）', offset: c.start, size, action: 'keep', note: '渲染必需的图像参数。', sensitivity: 'none' });
    } else if (PNG_TEXT_CHUNKS.has(c.type)) {
      segments.push({
        id: c.type,
        label: `文本块 ${c.type}`,
        offset: c.start,
        size,
        action: 'strip',
        note: c.type === 'iTXt' ? '可存放 XMP 元数据（含作者、软件、时间）。' : '可存放软件名称、作者、说明等文本。',
        sensitivity: 'high',
      });
    } else if (PNG_EXIF_CHUNKS.has(c.type)) {
      segments.push({
        id: 'eXIf',
        label: 'eXIf 元数据块',
        offset: c.start,
        size,
        action: 'strip',
        note: 'PNG 内嵌的完整 EXIF，可能包含 GPS 与拍摄时间。',
        sensitivity: 'high',
      });
    } else if (PNG_TIME_CHUNKS.has(c.type)) {
      segments.push({
        id: 'tIME',
        label: '最后修改时间',
        offset: c.start,
        size,
        action: 'strip',
        note: '记录图片最后一次修改的时间戳。',
        sensitivity: 'medium',
      });
    } else if (c.type === PNG_ICC) {
      segments.push({
        id: 'iCCP',
        label: 'ICC 色彩配置',
        offset: c.start,
        size,
        action: opts.keepIcc ? 'keep' : 'strip',
        note: opts.keepIcc ? '已选择保留，颜色更准确。' : '默认移除，色彩可能有极轻微变化。',
        sensitivity: 'low',
      });
    } else if (PNG_KEEP_STRUCTURAL.has(c.type)) {
      segments.push({ id: c.type, label: `图像数据块 ${c.type}`, offset: c.start, size, action: 'keep', note: '像素或渲染必需。', sensitivity: 'none' });
    } else if (c.type === 'IEND') {
      segments.push({ id: 'IEND', label: '图像结束标记', offset: c.start, size, action: 'keep', note: '结构标记。', sensitivity: 'none' });
    } else {
      // 未知的辅助块（首字母小写 = ancillary）。可能是私有元数据。
      const ancillary = c.type[0] === c.type[0].toLowerCase();
      segments.push({
        id: c.type,
        label: `未知数据块 ${c.type}`,
        offset: c.start,
        size,
        action: ancillary ? 'strip' : 'keep',
        note: ancillary ? '未知的辅助数据块，可能包含私有元数据，默认移除。' : '未知的关键块，为保证可解码而保留。',
        sensitivity: ancillary ? 'medium' : 'none',
      });
    }
  }

  if (endAfterIend >= 0 && endAfterIend < b.length) {
    scan.trailingBytes = b.length - endAfterIend;
    const trailingText = ascii(b, endAfterIend, Math.min(32, scan.trailingBytes));
    segments.push({
      id: 'TRAILING',
      label: 'IEND 之后的多余数据',
      offset: endAfterIend,
      size: scan.trailingBytes,
      action: 'strip',
      note: `IEND 之后不应有数据，此处有 ${scan.trailingBytes} 字节附加内容${trailingText.trim() ? `（以 "${trailingText.replace(/[^\x20-\x7e]/g, '.')}" 开头）` : ''}。`,
      sensitivity: 'high',
    });
  }

  scan.segments = segments;
  return finalize(scan);
}

/* ------------------------------------------------------------------ *
 * WebP
 * ------------------------------------------------------------------ */

const WEBP_KEEP = new Set(['VP8 ', 'VP8L', 'VP8X', 'ANIM', 'ANMF', 'ALPH']);

export function scanWebp(b: Uint8Array, options: ScanOptions = {}): ContainerScan {
  const opts = { ...DEFAULT_OPTS, ...options };
  const scan = emptyScan('webp');
  scan.supportsLosslessStrip = true;
  const segments: MetaSegment[] = [];
  const riffSize = u32le(b, 4);
  const declaredEnd = riffSize + 8;
  if (declaredEnd > b.length) {
    scan.truncated = true;
    scan.warnings.push('RIFF 声明的大小超过实际文件长度，文件可能被截断。');
  }
  let o = 12;
  const limit = Math.min(b.length, declaredEnd > 0 ? Math.max(declaredEnd, 12) : b.length);
  while (o + 8 <= limit) {
    const fourcc = ascii(b, o, 4);
    const size = u32le(b, o + 4);
    const padded = size + (size % 2);
    const end = o + 8 + padded;
    if (end > b.length) {
      scan.truncated = true;
      scan.warnings.push(`数据块 ${fourcc} 越界。`);
      break;
    }
    if (fourcc === 'VP8X' && size >= 10) {
      scan.width = u24le(b, o + 12) + 1;
      scan.height = u24le(b, o + 15) + 1;
      segments.push({ id: 'VP8X', label: '扩展头（尺寸 / 特性）', offset: o, size: end - o, action: 'keep', note: '记录画布尺寸、透明度与动画标记。', sensitivity: 'none' });
    } else if (fourcc === 'VP8 ' && size >= 10) {
      if (scan.width === undefined) {
        const w = (b[o + 14] | (b[o + 15] << 8)) & 0x3fff;
        const h = (b[o + 16] | (b[o + 17] << 8)) & 0x3fff;
        if (w && h) {
          scan.width = w;
          scan.height = h;
        }
      }
      segments.push({ id: 'VP8', label: '有损图像数据', offset: o, size: end - o, action: 'keep', note: '像素数据。', sensitivity: 'none' });
    } else if (fourcc === 'VP8L' && size >= 5) {
      if (scan.width === undefined) {
        const bits = u32le(b, o + 9);
        const w = (bits & 0x3fff) + 1;
        const h = ((bits >> 14) & 0x3fff) + 1;
        if (w && h) {
          scan.width = w;
          scan.height = h;
        }
      }
      segments.push({ id: 'VP8L', label: '无损图像数据', offset: o, size: end - o, action: 'keep', note: '像素数据。', sensitivity: 'none' });
    } else if (fourcc === 'EXIF') {
      segments.push({ id: 'EXIF', label: 'EXIF 元数据', offset: o, size: end - o, action: 'strip', note: '可能包含 GPS、设备型号与拍摄时间。', sensitivity: 'high' });
    } else if (fourcc === 'XMP ') {
      segments.push({ id: 'XMP', label: 'XMP 元数据', offset: o, size: end - o, action: 'strip', note: 'Adobe XMP，含编辑软件、作者、时间线。', sensitivity: 'high' });
    } else if (fourcc === 'ICCP') {
      segments.push({
        id: 'ICCP',
        label: 'ICC 色彩配置',
        offset: o,
        size: end - o,
        action: opts.keepIcc ? 'keep' : 'strip',
        note: opts.keepIcc ? '已选择保留。' : '默认移除，颜色可能有极轻微变化。',
        sensitivity: 'low',
      });
    } else if (WEBP_KEEP.has(fourcc)) {
      segments.push({ id: fourcc, label: `图像数据 ${fourcc}`, offset: o, size: end - o, action: 'keep', note: '像素或动画数据。', sensitivity: 'none' });
    } else {
      segments.push({ id: fourcc, label: `未知数据块 ${fourcc}`, offset: o, size: end - o, action: 'strip', note: '未知块可能是私有元数据，默认移除。', sensitivity: 'medium' });
    }
    o = end;
  }

  // RIFF 声明的长度之外可能存在附加数据。
  const realEnd = Math.min(b.length, Math.max(declaredEnd, o));
  if (declaredEnd > 0 && declaredEnd < b.length) {
    scan.trailingBytes = b.length - declaredEnd;
    segments.push({
      id: 'TRAILING',
      label: 'RIFF 之外的多余数据',
      offset: declaredEnd,
      size: scan.trailingBytes,
      action: 'strip',
      note: '超出 RIFF 声明长度的数据不属于图像本身。',
      sensitivity: 'medium',
    });
  } else if (realEnd < b.length) {
    scan.trailingBytes = b.length - realEnd;
  }

  scan.segments = segments;
  return finalize(scan);
}

/* ------------------------------------------------------------------ *
 * GIF
 * ------------------------------------------------------------------ */

export function scanGif(b: Uint8Array): ContainerScan {
  const scan = emptyScan('gif');
  scan.supportsLosslessStrip = true;
  const segments: MetaSegment[] = [];
  if (b.length < 13) {
    scan.truncated = true;
    scan.warnings.push('GIF 头不完整。');
    return finalize(scan);
  }
  // GIF 的多字节字段是小端序。
  scan.width = u16le(b, 6);
  scan.height = u16le(b, 8);
  segments.push({ id: 'HEADER', label: 'GIF 文件头与逻辑屏幕描述符', offset: 0, size: 13, action: 'keep', note: '结构信息。', sensitivity: 'none' });

  const packed = b[10];
  let o = 13;
  if (packed & 0x80) {
    const gctSize = 3 * (1 << ((packed & 0x07) + 1));
    segments.push({ id: 'GCT', label: '全局颜色表', offset: o, size: gctSize, action: 'keep', note: '渲染必需。', sensitivity: 'none' });
    o += gctSize;
  }

  let trailerEnd = -1;
  while (o < b.length) {
    const block = b[o];
    if (block === 0x3b) {
      segments.push({ id: 'TRAILER', label: 'GIF 结束标记', offset: o, size: 1, action: 'keep', note: '结构标记。', sensitivity: 'none' });
      trailerEnd = o + 1;
      break;
    }
    if (block === 0x21) {
      const label = b[o + 1];
      let p = o + 2;
      while (p < b.length && b[p] !== 0) {
        p += b[p] + 1;
      }
      const end = Math.min(p + 1, b.length);
      if (label === 0xf9) {
        segments.push({ id: 'GCE', label: '图形控制扩展', offset: o, size: end - o, action: 'keep', note: '帧延时与透明度，渲染必需。', sensitivity: 'none' });
      } else if (label === 0xff) {
        const appId = ascii(b, o + 3, Math.min(11, b.length - o - 3));
        const isXmp = /XMP/i.test(appId);
        segments.push({
          id: 'APPEXT',
          label: isXmp ? 'XMP 元数据扩展' : `应用扩展 (${appId.trim() || '未知'})`,
          offset: o,
          size: end - o,
          action: 'strip',
          note: isXmp ? 'GIF 内嵌的 XMP，包含作者、软件与时间线。' : '应用扩展块可携带任何私有数据。',
          sensitivity: isXmp ? 'high' : 'medium',
        });
      } else if (label === 0xfe) {
        segments.push({ id: 'COMMENT', label: '注释扩展', offset: o, size: end - o, action: 'strip', note: '自由文本，可能包含软件名或备注。', sensitivity: 'medium' });
      } else if (label === 0x01) {
        segments.push({ id: 'PLAINTEXT', label: '纯文本扩展', offset: o, size: end - o, action: 'strip', note: '可在图片上叠加文本内容。', sensitivity: 'medium' });
      } else {
        segments.push({ id: `EXT${label}`, label: `扩展块 0x${label.toString(16)}`, offset: o, size: end - o, action: 'strip', note: '未知扩展块，默认移除。', sensitivity: 'medium' });
      }
      o = end;
      continue;
    }
    if (block === 0x2c) {
      if (o + 10 > b.length) {
        scan.truncated = true;
        break;
      }
      const ipacked = b[o + 9];
      let p = o + 10;
      if (ipacked & 0x80) p += 3 * (1 << ((ipacked & 0x07) + 1));
      p += 1; // LZW 最小码长
      while (p < b.length && b[p] !== 0) p += b[p] + 1;
      const end = Math.min(p + 1, b.length);
      segments.push({ id: 'IMAGE', label: '图像块', offset: o, size: end - o, action: 'keep', note: '像素数据。', sensitivity: 'none' });
      o = end;
      continue;
    }
    scan.warnings.push(`偏移 ${o} 处出现无法识别的块 (0x${block.toString(16)})，停止解析。`);
    scan.truncated = true;
    break;
  }

  if (trailerEnd < 0) {
    scan.truncated = true;
    scan.warnings.push('未找到 GIF 结束标记。');
  }
  if (trailerEnd >= 0 && trailerEnd < b.length) {
    scan.trailingBytes = b.length - trailerEnd;
    segments.push({
      id: 'TRAILING',
      label: '结束标记之后的多余数据',
      offset: trailerEnd,
      size: scan.trailingBytes,
      action: 'strip',
      note: '正常 GIF 在结束标记后不应有数据。',
      sensitivity: 'medium',
    });
  }
  scan.segments = segments;
  return finalize(scan);
}

/* ------------------------------------------------------------------ *
 * 其余格式
 * ------------------------------------------------------------------ */

function unsupportedScan(kind: ScanKind, reason: string, extra: Partial<ContainerScan> = {}): ContainerScan {
  const scan = emptyScan(kind, [reason], false);
  scan.supportsLosslessStrip = false;
  scan.segments = [];
  return Object.assign(scan, extra);
}

export function scanContainer(b: Uint8Array, options: ScanOptions = {}): ContainerScan {
  if (b.length < 12) {
    return emptyScan('unknown', ['文件太小，无法识别为图片。'], true);
  }
  const kind = detectFormat(b);
  switch (kind) {
    case 'jpeg':
      return scanJpeg(b, options);
    case 'png':
      return scanPng(b, options);
    case 'webp':
      return scanWebp(b, options);
    case 'gif':
      return scanGif(b);
    case 'tiff':
      return unsupportedScan(
        'tiff',
        'TIFF 的结构与 EXIF 共用一套 IFD 体系，无损剥离需要重写整棵 IFD 树，本工具选择用 Canvas 重新编码以避免破坏结构。',
      );
    case 'bmp':
      return unsupportedScan('bmp', 'BMP 通常不携带元数据；如需处理会使用 Canvas 重新编码（无损转 PNG）。');
    case 'avif':
      return unsupportedScan('avif', 'AVIF 的元数据存放在 ISOBMFF 的 item 中，当前版本尚未实现无损剥离。');
    case 'heic':
      return unsupportedScan(
        'heic',
        'HEIC/HEIF 依赖浏览器解码支持。Safari 可解码，Chrome/Firefox 多数版本不能，因此本工具不会假装处理成功。',
      );
    case 'ico':
      return unsupportedScan('ico', 'ICO 图标不是以分享为目的的图片格式，暂不处理。');
    default:
      return unsupportedScan('unknown', '无法识别的文件格式。支持 JPEG / PNG / WebP / GIF。');
  }
}

/* ------------------------------------------------------------------ *
 * 重写（移除元数据块）
 * ------------------------------------------------------------------ */

export interface StripResult {
  bytes: Uint8Array;
  removed: MetaSegment[];
  kept: MetaSegment[];
}

function ranges(segments: MetaSegment[], action: StripAction): Array<[number, number]> {
  return segments
    .filter((s) => s.action === action)
    .map((s) => [s.offset, s.offset + s.size] as [number, number])
    .sort((a, b) => a[0] - b[0]);
}

/**
 * 按扫描结果重写容器：只保留 action === 'keep' 的块。
 * 对 JPEG/PNG/GIF 之外的结构（WebP）需要同步修正头部长度字段。
 */
export function stripContainer(b: Uint8Array, scan: ContainerScan): StripResult {
  if (!scan.supportsLosslessStrip) {
    throw new Error(`${scan.label} 不支持无损去除元数据，需要重新编码。`);
  }
  const removed = scan.segments.filter((s) => s.action === 'strip');
  const kept = scan.segments.filter((s) => s.action === 'keep');
  const keepRanges = ranges(scan.segments, 'keep');
  const parts: Uint8Array[] = [];

  if (scan.kind === 'jpeg') {
    // SOI 不在任何块内，单独保留。
    parts.push(copySlice(b, 0, 2));
    for (const [s, e] of keepRanges) {
      if (s === 0) continue; // 已包含 SOI
      parts.push(copySlice(b, s, e));
    }
    // 扫描数据结束于 EOI 之前，这里补回 EOI，保证文件仍可正常解码。
    if (kept.some((k) => k.id === 'SCAN')) parts.push(new Uint8Array([0xff, 0xd9]));
    return { bytes: concat(parts), removed, kept };
  }

  if (scan.kind === 'png') {
    // PNG 签名（8 字节）不属于任何 chunk，必须先写回。
    parts.push(copySlice(b, 0, 8));
    for (const [s, e] of keepRanges) parts.push(copySlice(b, s, e));
    return { bytes: concat(parts), removed, kept };
  }

  if (scan.kind === 'gif') {
    for (const [s, e] of keepRanges) parts.push(copySlice(b, s, e));
    return { bytes: concat(parts), removed, kept };
  }

  if (scan.kind === 'webp') {
    const body: Uint8Array[] = [];
    for (const s of kept) {
      const chunk = copySlice(b, s.offset, s.offset + s.size);
      if (s.id === 'VP8X') {
        // 同步清除 ICC / EXIF / XMP 标志位，避免解码器去读已被删除的块。
        const flags = chunk[8];
        const has = (id: string) => kept.some((k) => k.id === id);
        let next = flags & 0b11000111; // 保留 Rsv(7-6)、Alpha(4)、Animation(1)
        if (has('ICCP')) next |= 0b00100000;
        if (has('EXIF')) next |= 0b00001000;
        if (has('XMP')) next |= 0b00000100;
        chunk[8] = next;
      }
      body.push(chunk);
    }
    const payload = concat(body);
    // RIFF 头 12 字节 = "RIFF" + 长度 + "WEBP"，其后才是块数据。
    const out = new Uint8Array(12 + payload.length);
    out.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
    writeU32le(out, 4, payload.length + 4); // "WEBP" + payload
    out.set([0x57, 0x45, 0x42, 0x50], 8);
    out.set(payload, 12);
    return { bytes: out, removed, kept };
  }

  throw new Error(`未实现 ${scan.label} 的重写逻辑。`);
}

/** 判断一段字节是否已经是「干净」的容器（没有任何可移除块）。 */
export function isContainerClean(scan: ContainerScan): boolean {
  return scan.metadataCount === 0 && scan.trailingBytes === 0 && !scan.truncated;
}

export { u32be, writeU32be };
