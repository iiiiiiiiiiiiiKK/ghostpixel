/** 全项目共享的类型定义。 */

export type ScanKind =
  | 'jpeg'
  | 'png'
  | 'webp'
  | 'gif'
  | 'bmp'
  | 'avif'
  | 'heic'
  | 'tiff'
  | 'ico'
  | 'unknown';

export type StripAction = 'strip' | 'keep' | 'transcode';

export interface MetaSegment {
  /** 容器内的稳定标识，例如 'APP1'、'tEXt'、'LIST/EXIF'。 */
  id: string;
  /** 人类可读名称，例如 'EXIF 元数据 (APP1)'。 */
  label: string;
  /** 相对文件开头的偏移。 */
  offset: number;
  /** 该段占用的字节数。 */
  size: number;
  action: StripAction;
  /** 为什么会保留 / 会移除。 */
  note?: string;
  /** 敏感等级，用于 UI 高亮。 */
  sensitivity?: 'high' | 'medium' | 'low' | 'none';
}

export interface ContainerScan {
  kind: ScanKind;
  /** 格式显示名，例如 'JPEG'。 */
  label: string;
  mime: string;
  width?: number;
  height?: number;
  segments: MetaSegment[];
  /** 会被移除的元数据段数量。 */
  metadataCount: number;
  /** 会被移除的元数据字节数。 */
  metadataBytes: number;
  /** 图像结束标记之后的多余字节（隐藏数据常见位置）。 */
  trailingBytes: number;
  /** 是否支持无损（不重编码像素）清理。 */
  supportsLosslessStrip: boolean;
  warnings: string[];
  /** 结构完整性问题，例如缺少结束标记。 */
  truncated: boolean;
}

export interface MetaField {
  key: string;
  label: string;
  value: string;
  group: string;
  sensitivity: 'high' | 'medium' | 'low' | 'none';
  note?: string;
}

export interface MetaGroup {
  id: string;
  title: string;
  description?: string;
  fields: MetaField[];
}

export interface MetadataReport {
  groups: MetaGroup[];
  fieldCount: number;
  sensitiveCount: number;
  highSensitiveCount: number;
  hasGps: boolean;
  gps?: { latitude: number; longitude: number } | null;
  /** exifr 是否成功解析出结构化字段。 */
  parsed: boolean;
  /** 解析器说明 / 失败原因（用于“无法验证”的诚实披露）。 */
  parserNote?: string;
  /** 是否存在本工具未逐字段解析、但已在容器层识别出的元数据块。 */
  opaqueBlocks: string[];
}

export interface VerificationReport {
  /** 导出文件能否被浏览器解码。 */
  reopenable: boolean;
  reopenNote: string;
  /** 容器层是否仍有可移除的元数据段。 */
  containerClean: boolean;
  remainingSegments: string[];
  /** 清理前检测到的字段。 */
  detected: string[];
  /** 清理后仍然存在的字段（应为空）。 */
  stillPresent: string[];
  /** 已确认清除的字段。 */
  cleared: string[];
  /** 无法验证的部分（隐写、未解析格式、加密私有块等）。 */
  unverifiable: string[];
  widthBefore?: number;
  heightBefore?: number;
  widthAfter?: number;
  heightAfter?: number;
  dimensionsMatch: boolean;
  formatMatch: boolean;
}
