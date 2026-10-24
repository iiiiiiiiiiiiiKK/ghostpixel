/** 字节级工具函数。全部为纯函数，便于在 Node / 浏览器 / Worker 中复用。 */

export function u16be(b: Uint8Array, o: number): number {
  return (b[o] << 8) | b[o + 1];
}

export function u32be(b: Uint8Array, o: number): number {
  return ((b[o] << 24) >>> 0) + ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]);
}

export function u16le(b: Uint8Array, o: number): number {
  return b[o] | (b[o + 1] << 8);
}

export function u24le(b: Uint8Array, o: number): number {
  return b[o] | (b[o + 1] << 8) | (b[o + 2] << 16);
}

export function u32le(b: Uint8Array, o: number): number {
  return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | ((b[o + 3] << 24) >>> 0)) >>> 0;
}

export function writeU32be(b: Uint8Array, o: number, v: number): void {
  b[o] = (v >>> 24) & 0xff;
  b[o + 1] = (v >>> 16) & 0xff;
  b[o + 2] = (v >>> 8) & 0xff;
  b[o + 3] = v & 0xff;
}

export function writeU32le(b: Uint8Array, o: number, v: number): void {
  b[o] = v & 0xff;
  b[o + 1] = (v >>> 8) & 0xff;
  b[o + 2] = (v >>> 16) & 0xff;
  b[o + 3] = (v >>> 24) & 0xff;
}

/** 读取 Latin-1 (ASCII 兼容) 字符串，用于格式标识符。 */
export function ascii(b: Uint8Array, o: number, n: number): string {
  let s = '';
  const end = Math.min(o + n, b.length);
  for (let i = o; i < end; i++) s += String.fromCharCode(b[i]);
  return s;
}

export function concat(chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** 查找子序列，返回下标（找不到返回 -1）。 */
export function indexOfSeq(haystack: Uint8Array, needle: number[], from = 0): number {
  const n = needle.length;
  if (n === 0) return from;
  const last = haystack.length - n;
  outer: for (let i = Math.max(0, from); i <= last; i++) {
    for (let j = 0; j < n; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

/** 截干净的子数组副本（避免保留整块底层 buffer 造成内存泄漏）。 */
export function copySlice(b: Uint8Array, start: number, end: number): Uint8Array {
  return b.slice(start, end);
}

/**
 * 在文件中查找所有出现的 ASCII 标记（用于定位 XMP / IPTC / 私有块）。
 * 只扫描前 limit 字节，避免对超大文件做全量正则。
 */
export function findAllMarkers(
  b: Uint8Array,
  markers: string[],
  limit = 4 * 1024 * 1024,
): Array<{ marker: string; offset: number }> {
  const found: Array<{ marker: string; offset: number }> = [];
  const hay = b.subarray(0, Math.min(b.length, limit));
  for (const m of markers) {
    const needle = Array.from(m, (c) => c.charCodeAt(0));
    let from = 0;
    for (;;) {
      const at = indexOfSeq(hay, needle, from);
      if (at < 0) break;
      found.push({ marker: m, offset: at });
      from = at + needle.length;
      if (found.length > 64) break;
    }
  }
  return found;
}
