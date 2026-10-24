/**
 * 结构化元数据解析。
 *
 * 使用 exifr 解析 JPEG/TIFF/HEIC 的 EXIF、GPS、XMP、IPTC、ICC，
 * 并自行解析 PNG 的 tEXt/zTXt/iTXt 与 eXIf 块 —— 因为不同格式的元数据
 * 存放位置完全不同，单一的解析器无法覆盖全部。
 *
 * 解析失败时不会静默忽略：会记录 parserNote，在界面上以「无法验证」呈现。
 */
import exifr from 'exifr';
import { ascii, u32be } from './bytes.ts';
import { buildMetadataReport } from './fields.ts';
import type { ContainerScan, MetaField, MetadataReport } from './types.ts';

const MAX_RAW_BYTES = 64 * 1024 * 1024; // 单文件解析上限，防止超大图耗尽内存

export interface ParseResult {
  report: MetadataReport;
  /** exifr 输出的原始对象，便于调试与测试。 */
  raw: Record<string, unknown> | null;
  error?: string;
}

async function parseExifrSegment(buffer: ArrayBuffer): Promise<{ raw: Record<string, unknown> | null; error?: string }> {
  try {
    const raw = (await exifr.parse(buffer, {
      tiff: true,
      xmp: true,
      icc: false,
      iptc: true,
      jfif: false,
      ihdr: false,
      reviveValues: true,
      translateValues: true,
      translateKeys: true,
      sanitize: true,
      mergeOutput: true,
    })) as Record<string, unknown> | undefined;
    if (!raw || typeof raw !== 'object') return { raw: null, error: '解析器没有返回任何字段（很可能这张图片本来就没有 EXIF）。' };
    return { raw };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { raw: null, error: `EXIF 解析失败：${msg}。文件可能损坏或使用了不支持的编码。` };
  }
}

/* ---------------- PNG 文本块 ---------------- */

function decodeLatin1(b: Uint8Array): string {
  let s = '';
  for (const c of b) s += String.fromCharCode(c);
  return s;
}

function decodeUtf8(b: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: false }).decode(b);
  } catch {
    return decodeLatin1(b);
  }
}

export interface PngTextEntry {
  chunk: string;
  keyword: string;
  text: string;
}

export function readPngTextEntries(b: Uint8Array): PngTextEntry[] {
  const out: PngTextEntry[] = [];
  let o = 8;
  let guard = 0;
  while (o + 8 <= b.length && guard++ < 4096) {
    const len = u32be(b, o);
    const type = ascii(b, o + 4, 4);
    const dataStart = o + 8;
    if (len > 0x7fffffff || dataStart + len + 4 > b.length) break;
    if (type === 'tEXt' || type === 'zTXt' || type === 'iTXt') {
      const data = b.subarray(dataStart, dataStart + len);
      const nul = data.indexOf(0);
      const keyword = nul > 0 ? decodeLatin1(data.subarray(0, nul)) : '';
      let text = '';
      if (type === 'tEXt' && nul > 0) {
        text = decodeLatin1(data.subarray(nul + 1));
      } else if (type === 'iTXt' && nul > 0) {
        // 结构: keyword \0 compressionFlag compressionMethod languageTag \0 translatedKeyword \0 text
        let p = nul + 1;
        const compressed = data[p] === 1;
        p += 2;
        const langEnd = data.indexOf(0, p);
        p = langEnd >= 0 ? langEnd + 1 : p;
        const transEnd = data.indexOf(0, p);
        p = transEnd >= 0 ? transEnd + 1 : p;
        const payload = data.subarray(p);
        text = compressed ? '（zlib 压缩的国际化文本，未展开）' : decodeUtf8(payload);
      } else {
        text = '（zlib 压缩文本块，未展开）';
      }
      out.push({ chunk: type, keyword, text });
    }
    o = dataStart + len + 4;
    if (type === 'IEND') break;
  }
  return out;
}

function pngTextFields(entries: PngTextEntry[]): MetaField[] {
  const fields: MetaField[] = [];
  for (const e of entries) {
    const k = e.keyword.toLowerCase();
    let label = `PNG 文本：${e.keyword || '未命名'}`;
    let group = 'content';
    let sensitivity: MetaField['sensitivity'] = 'medium';
    let note: string | undefined;
    if (k === 'author' || k === 'creator' || k === 'artist') {
      label = 'PNG 作者';
      sensitivity = 'high';
    } else if (k === 'software' || k === 'creatortool') {
      label = 'PNG 生成软件';
      group = 'software';
      sensitivity = 'low';
    } else if (k === 'comment' || k === 'description') {
      label = 'PNG 描述/备注';
      sensitivity = 'medium';
    } else if (k === 'creation time' || k === 'date:create') {
      label = 'PNG 创建时间';
      group = 'capture';
      sensitivity = 'high';
    } else if (k === 'xml:com.adobe.xmp') {
      label = 'PNG 内嵌 XMP';
      sensitivity = 'high';
      note = 'XMP 是完整的一棵元数据树，可能含 GPS、作者、编辑历史。';
    } else if (k === 'disclaimer' || k === 'warning' || k === 'source') {
      sensitivity = 'low';
    }
    fields.push({
      key: `png.${e.chunk}.${e.keyword || 'unnamed'}`,
      label,
      value: e.text.trim() === '' ? '（空）' : e.text.slice(0, 400),
      group,
      sensitivity,
      note,
    });
  }
  return fields;
}

/* ---------------- 主入口 ---------------- */

export async function parseMetadata(bytes: Uint8Array, scan: ContainerScan): Promise<ParseResult> {
  if (bytes.byteLength > MAX_RAW_BYTES) {
    return {
      report: buildMetadataReport(null, {
        parserNote: `文件超过 ${MAX_RAW_BYTES / 1024 / 1024} MB，为避免页面卡死只做了容器层扫描，未逐字段解析。`,
        opaqueBlocks: scan.segments.filter((s) => s.action === 'strip').map((s) => s.label),
      }),
      raw: null,
      error: '文件过大，跳过深度解析。',
    };
  }

  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const opaqueBlocks = scan.segments.filter((s) => s.action === 'strip').map((s) => s.label);

  if (scan.kind === 'png') {
    const entries = readPngTextEntries(bytes);
    const textFields = pngTextFields(entries);
    // PNG 也可能带 eXIf 块，exifr 支持读取。
    const { raw, error } = await parseExifrSegment(buffer);
    const report = buildMetadataReport(raw, {
      parserNote: error && textFields.length === 0 ? error : undefined,
      opaqueBlocks,
    });
    if (textFields.length > 0) {
      // 合并：文本字段追加到对应分组。
      for (const f of textFields) {
        const target = report.groups.find((g) => g.id === f.group);
        if (target) target.fields.push(f);
        else report.groups.push({ id: f.group, title: f.group === 'software' ? '软件与处理痕迹' : '内容描述与署名', fields: [f] });
        report.fieldCount++;
        if (f.sensitivity === 'high') report.highSensitiveCount++;
        if (f.sensitivity === 'high' || f.sensitivity === 'medium') report.sensitiveCount++;
      }
      report.parsed = true;
      // 保持分组顺序稳定。
      const order = ['gps', 'device', 'capture', 'software', 'content', 'embedded', 'other'];
      report.groups.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    }
    // 只有容器里有元数据块但完全没解析出字段时，明确说明。
    if (!report.parsed && scan.metadataCount > 0) {
      report.parserNote = '检测到元数据块，但当前解析器无法把它展开为字段（可能是私有格式）。清理会整块移除这些数据。';
    }
    return { report, raw, error };
  }

  const { raw, error } = await parseExifrSegment(buffer);
  const report = buildMetadataReport(raw, {
    parserNote: error,
    opaqueBlocks,
  });

  if (scan.kind === 'webp') {
    // exifr 对 WebP 的 EXIF/ICC 支持有限，这里额外扫描 XMP 明文块，
    // 至少让用户看到「这里有一段 XMP」而不是一片空白。
    const xmpMarker = '\u003c\u0078\u003a\u0078\u006d\u0070\u006d\u0065\u0074\u0061';
    const rawText = ascii(bytes, 0, Math.min(bytes.length, 0)) || '';
    void rawText;
    const decoded = new TextDecoder('latin1').decode(bytes);
    const at = decoded.indexOf(xmpMarker);
    if (at >= 0) {
      const snippet = decoded.slice(at, Math.min(decoded.length, at + 2000));
      report.groups.push({
        id: 'embedded',
        title: '内嵌资源',
        description: '缩略图、厂商私有块等附属数据。',
        fields: [
          {
            key: 'webp.xmp.raw',
            label: 'WebP 内嵌 XMP',
            value: `${snippet.slice(0, 240)}…`,
            group: 'embedded',
            sensitivity: 'high',
            note: 'WebP 内嵌 XMP，可能包含作者、软件与编辑历史。',
          },
        ],
      });
      report.fieldCount++;
      report.sensitiveCount++;
      report.highSensitiveCount++;
      report.parsed = true;
    }
  }

  if (!report.parsed && scan.metadataCount > 0) {
    report.parserNote = report.parserNote ?? '检测到元数据块，但解析器未能展开为字段。清理会整块移除这些数据。';
  }
  return { report, raw, error };
}
