/**
 * 元数据解析：把 exifr 解析出的扁平对象整理成分组、可读、带敏感度标记的字段。
 * 采用叶子路径（例如 'gps.latitude'）作为唯一 key，便于清理前后做集合比较。
 */
import type { MetaField, MetaGroup, MetadataReport } from './types.ts';

export interface FieldSpec {
  label: string;
  group: string;
  sensitivity: MetaField['sensitivity'];
  note?: string;
}

/** 已知字段的展示名称 / 分组 / 敏感度。未列出的字段走通用规则。 */
export const FIELD_SPECS: Record<string, FieldSpec> = {
  // 设备
  Make: { label: '设备品牌', group: 'device', sensitivity: 'medium' },
  Model: { label: '设备型号', group: 'device', sensitivity: 'high', note: '可精确到具体机型，常与序列号一起用于关联设备。' },
  LensMake: { label: '镜头品牌', group: 'device', sensitivity: 'low' },
  LensModel: { label: '镜头型号', group: 'device', sensitivity: 'medium' },
  SerialNumber: { label: '机身序列号', group: 'device', sensitivity: 'high' },
  BodySerialNumber: { label: '机身序列号', group: 'device', sensitivity: 'high' },
  LensSerialNumber: { label: '镜头序列号', group: 'device', sensitivity: 'high' },
  InternalSerialNumber: { label: '内部序列号', group: 'device', sensitivity: 'high' },
  OwnerName: { label: '相机所有者', group: 'device', sensitivity: 'high' },
  CameraOwnerName: { label: '相机所有者', group: 'device', sensitivity: 'high' },
  Software: { label: '处理软件', group: 'software', sensitivity: 'low' },
  ProcessingSoftware: { label: '处理软件', group: 'software', sensitivity: 'low' },
  HostComputer: { label: '处理设备名称', group: 'software', sensitivity: 'medium' },
  // 拍摄
  DateTimeOriginal: { label: '拍摄时间', group: 'capture', sensitivity: 'high' },
  CreateDate: { label: '创建时间', group: 'capture', sensitivity: 'high' },
  ModifyDate: { label: '修改时间', group: 'capture', sensitivity: 'medium' },
  DateTimeDigitized: { label: '数字化时间', group: 'capture', sensitivity: 'medium' },
  OffsetTime: { label: '时区偏移', group: 'capture', sensitivity: 'low' },
  ExposureTime: { label: '曝光时间', group: 'capture', sensitivity: 'none' },
  FNumber: { label: '光圈', group: 'capture', sensitivity: 'none' },
  ISO: { label: 'ISO', group: 'capture', sensitivity: 'none' },
  ISOSpeedRatings: { label: 'ISO', group: 'capture', sensitivity: 'none' },
  FocalLength: { label: '焦距', group: 'capture', sensitivity: 'none' },
  FocalLengthIn35mmFormat: { label: '等效焦距', group: 'capture', sensitivity: 'none' },
  ExposureProgram: { label: '曝光模式', group: 'capture', sensitivity: 'none' },
  Flash: { label: '闪光灯', group: 'capture', sensitivity: 'none' },
  WhiteBalance: { label: '白平衡', group: 'capture', sensitivity: 'none' },
  Orientation: { label: '方向', group: 'capture', sensitivity: 'low', note: '删除后部分查看器可能按原始方向显示。' },
  ColorSpace: { label: '色彩空间', group: 'capture', sensitivity: 'none' },
  UserComment: { label: '用户备注', group: 'capture', sensitivity: 'high', note: '自由文本，可能包含姓名、地点或内部备注。' },
  ImageDescription: { label: '图片描述', group: 'content', sensitivity: 'medium' },
  Artist: { label: '作者', group: 'content', sensitivity: 'high' },
  Copyright: { label: '版权信息', group: 'content', sensitivity: 'medium' },
  XPTitle: { label: 'Windows 标题', group: 'content', sensitivity: 'low' },
  XPComment: { label: 'Windows 备注', group: 'content', sensitivity: 'medium' },
  XPAuthor: { label: 'Windows 作者', group: 'content', sensitivity: 'high' },
  XPSubject: { label: 'Windows 主题', group: 'content', sensitivity: 'low' },
  XPKeywords: { label: 'Windows 关键词', group: 'content', sensitivity: 'low' },
  // GPS
  GPSLatitude: { label: 'GPS 纬度', group: 'gps', sensitivity: 'high' },
  GPSLongitude: { label: 'GPS 经度', group: 'gps', sensitivity: 'high' },
  GPSAltitude: { label: 'GPS 海拔', group: 'gps', sensitivity: 'high' },
  GPSAltitudeRef: { label: '海拔基准', group: 'gps', sensitivity: 'low' },
  GPSSpeed: { label: 'GPS 速度', group: 'gps', sensitivity: 'medium' },
  GPSSpeedRef: { label: '速度单位', group: 'gps', sensitivity: 'none' },
  GPSImgDirection: { label: '拍摄朝向', group: 'gps', sensitivity: 'medium' },
  GPSImgDirectionRef: { label: '朝向基准', group: 'gps', sensitivity: 'none' },
  GPSDateStamp: { label: 'GPS 日期', group: 'gps', sensitivity: 'high' },
  GPSTimeStamp: { label: 'GPS 时间', group: 'gps', sensitivity: 'high' },
  GPSProcessingMethod: { label: '定位方式', group: 'gps', sensitivity: 'medium' },
  GPSLatitudeRef: { label: '南北半球', group: 'gps', sensitivity: 'none' },
  GPSLongitudeRef: { label: '东西半球', group: 'gps', sensitivity: 'none' },
  GPSVersionID: { label: 'GPS 版本', group: 'gps', sensitivity: 'none' },
  GPSDOP: { label: '定位精度', group: 'gps', sensitivity: 'low' },
  latitude: { label: 'GPS 纬度', group: 'gps', sensitivity: 'high' },
  longitude: { label: 'GPS 经度', group: 'gps', sensitivity: 'high' },
  // 缩略图 / 其他
  thumbnail: { label: '内嵌缩略图', group: 'embedded', sensitivity: 'medium', note: '缩略图可能保留删除前的画面内容。' },
  MakerNote: { label: '厂商私有数据', group: 'embedded', sensitivity: 'medium' },
  UserComment2: { label: '用户备注', group: 'capture', sensitivity: 'high' },
  // XMP / IPTC
  Creator: { label: 'XMP 创建者', group: 'content', sensitivity: 'high' },
  CreatorTool: { label: 'XMP 工具', group: 'software', sensitivity: 'low' },
  title: { label: '标题', group: 'content', sensitivity: 'low' },
  description: { label: '描述', group: 'content', sensitivity: 'medium' },
  subject: { label: '主题', group: 'content', sensitivity: 'low' },
  rights: { label: '权利声明', group: 'content', sensitivity: 'low' },
  City: { label: '城市', group: 'gps', sensitivity: 'high' },
  Country: { label: '国家/地区', group: 'gps', sensitivity: 'high' },
  ProvinceState: { label: '省/州', group: 'gps', sensitivity: 'high' },
  Sublocation: { label: '子位置', group: 'gps', sensitivity: 'high' },
};

export const GROUP_ORDER: Array<{ id: string; title: string; description?: string }> = [
  {
    id: 'gps',
    title: '位置信息',
    description: '一旦泄露，可直接定位到拍摄地点。这是图片中最敏感的元数据。',
  },
  {
    id: 'device',
    title: '设备与硬件',
    description: '品牌、型号、序列号，可用于关联同一台设备的其他照片。',
  },
  {
    id: 'capture',
    title: '拍摄参数',
    description: '拍摄时间与相机参数。参数本身不敏感，但时间戳常被用于交叉比对。',
  },
  {
    id: 'software',
    title: '软件与处理痕迹',
    description: '编辑软件、导出工具、处理设备名称。',
  },
  {
    id: 'content',
    title: '内容描述与署名',
    description: '作者、版权、备注等文本字段，常包含真实姓名或内部信息。',
  },
  {
    id: 'embedded',
    title: '内嵌资源',
    description: '缩略图、厂商私有块等附属数据。',
  },
  {
    id: 'other',
    title: '其他字段',
    description: '解析器读出但未归类到上面的字段。',
  },
];

const SKIP_KEYS = new Set(['thumbnail', 'makerNote', 'userComment', 'composite', 'errors', 'parseErrors']);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof Date);
}

export function formatValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return '无效日期';
    return v.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
  }
  if (typeof v === 'number') {
    if (Number.isInteger(v)) return String(v);
    return String(Math.round(v * 1e6) / 1e6);
  }
  if (typeof v === 'boolean') return v ? '是' : '否';
  if (typeof v === 'string') {
    const s = v.replace(/\u0000+$/g, '').trim();
    return s === '' ? '（空）' : s;
  }
  if (Array.isArray(v)) {
    if (v.length === 0) return '—';
    return v.map(formatValue).join(', ');
  }
  if (v instanceof Uint8Array || v instanceof ArrayBuffer) {
    const len = v instanceof Uint8Array ? v.byteLength : v.byteLength;
    return `二进制数据（${len} 字节）`;
  }
  if (isPlainObject(v)) {
    const parts = Object.entries(v)
      .filter(([, val]) => val !== null && val !== undefined)
      .slice(0, 8)
      .map(([k, val]) => `${k}: ${formatValue(val)}`);
    return parts.length ? parts.join('; ') : '—';
  }
  return String(v);
}

function specFor(path: string, leaf: string, group: string): FieldSpec {
  if (FIELD_SPECS[path]) return FIELD_SPECS[path];
  if (FIELD_SPECS[leaf]) return FIELD_SPECS[leaf];
  const guessedGroup = group === 'other' ? group : group;
  return { label: leaf, group: guessedGroup, sensitivity: 'low' };
}

/** 把 exifr 的输出拍平成路径 -> 值 的映射。 */
export function flattenMetadata(
  input: Record<string, unknown>,
  prefix = '',
  out: Array<{ path: string; leaf: string; group: string; value: unknown }> = [],
  depth = 0,
): Array<{ path: string; leaf: string; group: string; value: unknown }> {
  if (depth > 6) return out;
  for (const [k, v] of Object.entries(input)) {
    if (SKIP_KEYS.has(k)) continue;
    if (v === null || v === undefined) continue;
    if (k === 'errors' || k === 'parseErrors') continue;
    const path = prefix ? `${prefix}.${k}` : k;
    const groupHint = /^gps/i.test(k) || /^(GPS|City|Country|ProvinceState|Sublocation)$/.test(k) ? 'gps' : 'other';
    if (isPlainObject(v)) {
      flattenMetadata(v as Record<string, unknown>, path, out, depth + 1);
      continue;
    }
    if (Array.isArray(v) && v.length > 0 && v.every(isPlainObject)) {
      // 跳过对象数组（例如重复的 GPS 点位集合），只保留结构化标量。
      out.push({ path, leaf: k, group: groupHint, value: v });
      continue;
    }
    out.push({ path, leaf: k, group: groupHint, value: v });
  }
  return out;
}

export interface BuildReportOptions {
  /** 解析器附加说明，例如 exifr 抛错时的降级信息。 */
  parserNote?: string;
  /** 容器层识别到的、本工具未逐字段解析的元数据块。 */
  opaqueBlocks?: string[];
}

export function buildMetadataReport(
  raw: Record<string, unknown> | null | undefined,
  opts: BuildReportOptions = {},
): MetadataReport {
  const flat = raw ? flattenMetadata(raw) : [];
  const seen = new Set<string>();
  const fields: MetaField[] = [];
  for (const item of flat) {
    if (seen.has(item.path)) continue;
    seen.add(item.path);
    const spec = specFor(item.path, item.leaf, item.group);
    const group = item.path.startsWith('gps') || /^gps/i.test(item.leaf) ? 'gps' : spec.group;
    fields.push({
      key: item.path,
      label: spec.label,
      value: formatValue(item.value),
      group,
      sensitivity: spec.sensitivity,
      note: spec.note,
    });
  }

  const groups: MetaGroup[] = [];
  for (const g of GROUP_ORDER) {
    const items = fields.filter((f) => f.group === g.id);
    if (items.length === 0) continue;
    groups.push({ id: g.id, title: g.title, description: g.description, fields: items });
  }

  const highSensitiveCount = fields.filter((f) => f.sensitivity === 'high').length;
  const sensitiveCount = fields.filter((f) => f.sensitivity === 'high' || f.sensitivity === 'medium').length;
  const gpsField = fields.find((f) => f.group === 'gps' && /纬度|经度/.test(f.label));
  let gps: { latitude: number; longitude: number } | null = null;
  const lat = raw?.latitude;
  const lon = raw?.longitude;
  if (typeof lat === 'number' && typeof lon === 'number') gps = { latitude: lat, longitude: lon };

  return {
    groups,
    fieldCount: fields.length,
    sensitiveCount,
    highSensitiveCount,
    hasGps: gps !== null || gpsField !== undefined,
    gps,
    parsed: fields.length > 0,
    parserNote: opts.parserNote,
    opaqueBlocks: opts.opaqueBlocks ?? [],
  };
}

/** 所有字段 key 的集合，用于清理前后对比。 */
export function reportKeys(report: MetadataReport): string[] {
  const keys: string[] = [];
  for (const g of report.groups) for (const f of g.fields) keys.push(f.key);
  return keys;
}
