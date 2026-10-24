/**
 * 浏览器端图像工具：解码尺寸、重新编码、生成预览。
 *
 * 所有函数只在本地内存中操作 Blob / ObjectURL，不发任何网络请求。
 */
import type { ContainerScan } from './types.ts';

export interface DecodedInfo {
  width: number;
  height: number;
  /** 是否成功解码（用于验证导出文件真的能打开）。 */
  ok: boolean;
  note: string;
}

const MAX_PIXELS = 40_000_000; // 约 40MP，超过则拒绝，防止解码 OOM

export async function decodeInfo(blob: Blob): Promise<DecodedInfo> {
  // 优先用 createImageBitmap：不触发 DOM 布局，且能拿到真实解码后尺寸。
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(blob);
      const info = { width: bmp.width, height: bmp.height, ok: true, note: '浏览器解码成功' };
      bmp.close?.();
      return info;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { width: 0, height: 0, ok: false, note: `浏览器无法解码该文件：${msg}` };
    }
  }
  // 回退到 <img> 解码（老浏览器 / jsdom）。
  return new Promise<DecodedInfo>((resolve) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight, ok: true, note: '浏览器解码成功' });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      resolve({ width: 0, height: 0, ok: false, note: '浏览器无法解码该文件。' });
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });
}

export function tooManyPixels(width: number, height: number): boolean {
  return width * height > MAX_PIXELS;
}

/**
 * 用 Canvas 重新编码。
 *
 * 这是「不可逆」的处理路径，会带来三类可观察到的变化，界面必须如实说明：
 *  1. 格式可能改变（TIFF/BMP/HEIC → PNG 或 WebP）；
 *  2. 透明通道可能变化（JPEG 不支持透明，会被填充为白色）；
 *  3. 有损格式会重新压缩，产生画质损失。
 * 因此本工具只在无损剥离不可用时才走这条路。
 */
export async function transcode(
  source: Blob,
  target: 'image/png' | 'image/webp' | 'image/jpeg',
  quality = 0.92,
): Promise<{ blob: Blob; width: number; height: number }> {
  if (typeof createImageBitmap !== 'function') throw new Error('当前浏览器不支持 createImageBitmap，无法重新编码。');
  const bmp = await createImageBitmap(source);
  try {
    if (tooManyPixels(bmp.width, bmp.height)) {
      throw new Error(`图像像素数过大（${bmp.width}×${bmp.height}），已停止处理以避免浏览器崩溃。`);
    }
    const canvas = document.createElement('canvas');
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('无法创建 2D 绘图上下文。');
    if (target === 'image/jpeg') {
      // JPEG 无 alpha：必须填充背景，否则透明区域会变黑。
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(bmp, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, target, quality));
    if (!blob) throw new Error('浏览器拒绝生成目标格式（可能是容器不支持该编码）。');
    return { blob, width: bmp.width, height: bmp.height };
  } finally {
    bmp.close?.();
  }
}

/** 为预览创建对象 URL，并返回配套的释放函数。 */
export function createPreviewUrl(blob: Blob): { url: string; revoke: () => void } {
  const url = URL.createObjectURL(blob);
  let revoked = false;
  return {
    url,
    revoke: () => {
      if (revoked) return;
      revoked = true;
      URL.revokeObjectURL(url);
    },
  };
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function deltaLabel(before: number, after: number): string {
  const diff = after - before;
  if (diff === 0) return '无变化';
  const pct = before === 0 ? 0 : (diff / before) * 100;
  const sign = diff > 0 ? '+' : '−';
  return `${sign}${formatBytes(Math.abs(diff))}（${sign}${Math.abs(pct).toFixed(1)}%）`;
}

export function extensionFor(mime: string): string {
  switch (mime) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    case 'image/gif':
      return 'gif';
    default:
      return 'bin';
  }
}

export function cleanedFileName(name: string, mime: string): string {
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  return `${base}.cleaned.${extensionFor(mime)}`;
}

/** 从像素尺寸推断格式能力（用于 UI 提示，不参与清理决策）。 */
export function losslessNote(scan: ContainerScan): string {
  if (scan.supportsLosslessStrip) return '像素数据原样复制，不会重新压缩，因此没有画质损失。';
  return '该格式需要重新编码，像素会被重新压缩，画质可能有轻微损失。';
}
