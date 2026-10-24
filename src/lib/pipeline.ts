/**
 * 处理流水线：分析 → 清理 → 验证。
 *
 * 关键点：清理后的结果一定会被重新读回并再次解析（而不是只把界面上的
 * 字段删掉），只有「重新解析后确实不存在」的字段才会被标记为「已清除」。
 */
import { detectFormat, FORMAT_LABEL, FORMAT_MIME, isContainerClean, scanContainer, stripContainer } from './containers.ts';
import { formatBytes, cleanedFileName, decodeInfo, transcode } from './image.ts';
import { parseMetadata } from './parse.ts';
import { reportKeys } from './fields.ts';
import type { ContainerScan, MetadataReport, VerificationReport } from './types.ts';

export interface CleanOptions {
  /** 保留 ICC 色彩配置。 */
  keepIcc: boolean;
  /** 超过该像素数时要求确认（大图处理可能长时间占用主线程）。 */
  maxPixelsWarn: number;
}

export const DEFAULT_CLEAN_OPTIONS: CleanOptions = { keepIcc: false, maxPixelsWarn: 40_000_000 };

export interface AnalyzeResult {
  bytes: Uint8Array;
  scan: ContainerScan;
  report: MetadataReport;
  mime: string;
  label: string;
  /** 清理是否需要重新编码（会损失画质）。 */
  requiresTranscode: boolean;
}

export async function analyzeBytes(bytes: Uint8Array, options: Pick<CleanOptions, 'keepIcc'> = { keepIcc: false }): Promise<AnalyzeResult> {
  const scan = scanContainer(bytes, { keepIcc: options.keepIcc });
  const { report } = await parseMetadata(bytes, scan);
  return {
    bytes,
    scan,
    report,
    mime: scan.mime,
    label: scan.label,
    requiresTranscode: !scan.supportsLosslessStrip,
  };
}

export interface CleanOutcome {
  ok: boolean;
  /** 导出用的字节。失败时为 undefined。 */
  output?: Uint8Array;
  outputMime: string;
  outputName?: string;
  verification?: VerificationReport;
  /** 用户可读的失败原因。 */
  error?: string;
  /** 是否走了重编码路径。 */
  transcoded: boolean;
  /** 处理耗时（毫秒），仅用于展示。 */
  elapsedMs: number;
}

const TRANSCODE_TARGET: Record<string, { mime: 'image/png' | 'image/webp'; note: string }> = {
  tiff: { mime: 'image/png', note: 'TIFF 会被转换为 PNG（无损容器，但颜色位深可能被规范化为 8 位）。' },
  bmp: { mime: 'image/png', note: 'BMP 会被转换为 PNG（通常文件更小，视觉无损）。' },
  avif: { mime: 'image/png', note: 'AVIF 会被转换为 PNG；透明度保留，但不再有 AVIF 的压缩效率。' },
  heic: { mime: 'image/png', note: 'HEIC 会被转换为 PNG；仅在浏览器能解码该 HEIC 时才会成功。' },
  ico: { mime: 'image/png', note: 'ICO 会被转换为 PNG。' },
  jpeg: { mime: 'image/png', note: 'JPEG 会被重新编码。' },
  png: { mime: 'image/png', note: 'PNG 会被重新编码。' },
  webp: { mime: 'image/png', note: 'WebP 会被重新编码。' },
  gif: { mime: 'image/png', note: 'GIF 会被重新编码。' },
  unknown: { mime: 'image/png', note: '未知格式将被重新编码。' },
};

/**
 * 执行清理并做真实验证。
 *
 * 优先使用无损剥离（不触碰像素）；只有在容器结构无法安全重写时才退回到
 * Canvas 重编码，并且在结果里明确标注会发生的变化。
 */
export async function cleanImage(
  file: { name: string; blob: Blob },
  analysis: AnalyzeResult,
  options: CleanOptions = DEFAULT_CLEAN_OPTIONS,
): Promise<CleanOutcome> {
  const started = performance.now();
  const before = analysis.scan;
  const beforeReport = analysis.report;
  const detectedKeys = reportKeys(beforeReport);

  /** 无论走哪条路径，都用同一套函数验证最终字节。 */
  const verify = async (outBytes: Uint8Array, outMime: string, transcoded: boolean): Promise<VerificationReport> => {
    const reScan = scanContainer(outBytes, { keepIcc: options.keepIcc });
    const { report: reReport } = await parseMetadata(outBytes, reScan);
    const afterKeys = new Set(reportKeys(reReport));

    const stillPresent = detectedKeys.filter((k) => afterKeys.has(k));
    const cleared = detectedKeys.filter((k) => !afterKeys.has(k));

    // 真实解码验证：能不能被浏览器重新打开。
    let reopenable = true;
    let reopenNote = '浏览器成功解码导出文件';
    const outBlob = new Blob([outBytes.slice().buffer as ArrayBuffer], { type: outMime });
    const decoded = await decodeInfo(outBlob);
    reopenable = decoded.ok;
    reopenNote = decoded.note;

    const remainingSegments = reScan.segments.filter((s) => s.action === 'strip').map((s) => `${s.label}（${s.size} 字节）`);
    const containerClean = isContainerClean(reScan);

    const unverifiable: string[] = [];
    unverifiable.push('像素级隐写（把数据编码进像素最低有效位）无法通过元数据清理移除，本工具也未做隐写检测。');
    if (transcoded) {
      unverifiable.push('重编码后的图片由浏览器 Canvas 生成，本工具只能确认「没有已知的元数据块」，无法排除编码器写入的私有块。');
    }
    if (reScan.truncated) {
      unverifiable.push('导出文件结构被判定为不完整，验证结果不可靠。');
    }
    unverifiable.push('云端/社交平台在转发时可能重新写入自己的元数据，这不在本工具的控制范围内。');

    return {
      reopenable,
      reopenNote,
      containerClean,
      remainingSegments,
      detected: detectedKeys,
      stillPresent,
      cleared,
      unverifiable,
      widthBefore: before.width,
      heightBefore: before.height,
      widthAfter: reScan.width,
      heightAfter: reScan.height,
      dimensionsMatch: before.width === reScan.width && before.height === reScan.height,
      formatMatch: detectFormat(outBytes) === before.kind,
    };
  };

  try {
    // ---- 路径 A：无损剥离 ----
    if (before.supportsLosslessStrip) {
      const { bytes: out } = stripContainer(analysis.bytes, before);
      const verification = await verify(out, before.mime, false);
      const ok = verification.reopenable && verification.stillPresent.length === 0 && verification.containerClean;
      if (ok) {
        return {
          ok: true,
          output: out,
          outputMime: before.mime,
          outputName: cleanedFileName(file.name, before.mime),
          verification,
          transcoded: false,
          elapsedMs: Math.round(performance.now() - started),
        };
      }
      // 无损剥离后仍不干净（例如解析器读出了我们未识别的块里的字段）：
      // 不隐瞒，直接尝试重编码作为兜底，并在结果里说明。
      const fallback = await transcodeAndVerify(file, analysis, options, verify);
      if (fallback.ok) {
        fallback.verification!.unverifiable.push(
          '无损剥离后仍检测到字段（可能位于无法安全移除的块内），因此改用重新编码完成清理。',
        );
        return fallback;
      }
      return {
        ok: false,
        outputMime: before.mime,
        error:
          verification.stillPresent.length > 0
            ? `无法完成清理：重新解析后仍有 ${verification.stillPresent.length} 个字段残留（${verification.stillPresent.slice(0, 5).join('、')}）。为避免给出错误的「已清除」结论，本次不提供下载。`
            : `导出文件无法被浏览器重新打开（${verification.reopenNote}），已放弃输出以免产生损坏文件。`,
        verification,
        transcoded: false,
        elapsedMs: Math.round(performance.now() - started),
      };
    }

    // ---- 路径 B：重编码 ----
    return await transcodeAndVerify(file, analysis, options, verify);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      outputMime: FORMAT_MIME[before.kind],
      error: `处理失败：${msg}`,
      transcoded: false,
      elapsedMs: Math.round(performance.now() - started),
    };
  }
}

async function transcodeAndVerify(
  file: { name: string; blob: Blob },
  analysis: AnalyzeResult,
  _options: CleanOptions,
  verify: (out: Uint8Array, mime: string, transcoded: boolean) => Promise<VerificationReport>,
): Promise<CleanOutcome> {
  const started = performance.now();
  const target = TRANSCODE_TARGET[analysis.scan.kind] ?? TRANSCODE_TARGET.unknown;
  const { blob, width, height } = await transcode(file.blob, target.mime, 0.95);
  const out = new Uint8Array(await blob.arrayBuffer());
  const verification = await verify(out, target.mime, true);
  verification.unverifiable.push(target.note);
  if (analysis.scan.kind !== 'png' && analysis.scan.kind !== 'webp' && analysis.scan.kind !== 'jpeg') {
    verification.formatMatch = false;
    verification.unverifiable.push(
      `格式已从 ${FORMAT_LABEL[analysis.scan.kind]} 转换为 PNG，像素尺寸 ${width}×${height} 应保持一致。`,
    );
  }
  const ok = verification.reopenable && verification.stillPresent.length === 0 && verification.containerClean;
  return {
    ok,
    output: ok ? out : undefined,
    outputMime: ok ? target.mime : analysis.scan.mime,
    outputName: ok ? cleanedFileName(file.name, target.mime) : undefined,
    verification,
    error: ok
      ? undefined
      : !verification.reopenable
        ? `重新编码失败：${verification.reopenNote}`
        : `重新编码后仍检测到 ${verification.stillPresent.length} 个字段残留，已放弃输出。`,
    transcoded: true,
    elapsedMs: Math.round(performance.now() - started),
  };
}

/** 供界面展示的一段“处理前后说明”。 */
export function describePlan(scan: ContainerScan): string {
  if (scan.kind === 'unknown') return '无法识别的格式，不会做任何处理。';
  if (scan.supportsLosslessStrip) {
    const n = scan.metadataCount;
    if (n === 0 && scan.trailingBytes === 0) {
      return `这是一张已经比较干净的 ${scan.label}：没有发现可移除的元数据块。清理仍可执行，但预计输出与输入基本相同。`;
    }
    return `将以「整块删除」的方式移除 ${n} 个元数据块（共 ${formatBytes(scan.metadataBytes)}），像素数据原样复制，因此不会重新压缩、不损失画质。`;
  }
  return `该格式无法安全做无损剥离，将使用浏览器 Canvas 重新编码为 PNG。这会改变格式、可能改变透明通道处理方式，并带来一次有损/规范化的重新压缩。`;
}
