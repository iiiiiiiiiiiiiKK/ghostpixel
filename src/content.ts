export interface XLink {
  handle: string;
  url: string;
}

/** 作者社交入口 —— 页头与页脚都会使用。 */
export const AUTHOR_X: XLink = { handle: '@0xkillcoin', url: 'https://x.com/0xkillcoin' };
export const REPO_URL = 'https://github.com/iiiiiiiiiiiiiKK/ghostpixel';

export interface FormatRow {
  format: string;
  extensions: string;
  read: string;
  strip: string;
  strategy: '无损剥离' | '重新编码' | '仅检测';
  caveat: string;
}

/** 支持矩阵：明确写出每种格式能做到什么、做不到什么。 */
export const FORMAT_MATRIX: FormatRow[] = [
  {
    format: 'JPEG',
    extensions: '.jpg .jpeg',
    read: 'EXIF · GPS · XMP · IPTC · ICC · 注释',
    strip: '整段移除 APP1/APP13/APP15/COM 等元数据块',
    strategy: '无损剥离',
    caveat: '保留 JFIF(APP0)、Adobe(APP14) 与量化表——它们是解码必需，不包含拍摄信息。',
  },
  {
    format: 'PNG',
    extensions: '.png',
    read: 'tEXt · zTXt · iTXt · eXIf · tIME · iCCP',
    strip: '移除全部文本块、eXIf、时间块、未知辅助块与 IEND 之后的附加数据',
    strategy: '无损剥离',
    caveat: 'IHDR/PLTE/IDAT/tRNS 等像素与结构块保持不变，透明通道不受影响。',
  },
  {
    format: 'WebP',
    extensions: '.webp',
    read: 'EXIF · XMP · ICCP 块',
    strip: '移除 EXIF / XMP / ICCP，并同步修正 VP8X 标志位与 RIFF 长度',
    strategy: '无损剥离',
    caveat: '修复 VP8X 的特定位是必须的，否则解码器会去找已删除的块而报错。',
  },
  {
    format: 'GIF',
    extensions: '.gif',
    read: '注释扩展 · 应用扩展（含 XMP）· 纯文本扩展',
    strip: '移除注释、应用扩展与纯文本扩展块',
    strategy: '无损剥离',
    caveat: '帧数据、调色板与图形控制扩展保持不变，动画时序不受影响。',
  },
  {
    format: 'TIFF',
    extensions: '.tif .tiff',
    read: '完整 EXIF（TIFF 就是 EXIF 的母体）',
    strip: '通过 Canvas 重新编码为 PNG',
    strategy: '重新编码',
    caveat: '格式会被改变，位深可能被规范化为 8 位；不保证保留多页 TIFF。',
  },
  {
    format: 'BMP',
    extensions: '.bmp',
    read: '通常无元数据',
    strip: '通过 Canvas 重新编码为 PNG',
    strategy: '重新编码',
    caveat: '格式改变；像素本身通常不含隐私信息，重编码主要为了统一输出。',
  },
  {
    format: 'AVIF',
    extensions: '.avif',
    read: '仅容器层可见性（未逐字段解析 ISOBMFF item）',
    strip: '通过 Canvas 重新编码为 PNG',
    strategy: '重新编码',
    caveat: '依赖浏览器解码能力；不保证 HDR 与色彩信息完全保留。',
  },
  {
    format: 'HEIC / HEIF',
    extensions: '.heic .heif',
    read: '仅当浏览器能解码时才可读取',
    strip: '通过 Canvas 重新编码为 PNG',
    strategy: '重新编码',
    caveat: 'Chrome / Firefox 多数版本无法解码 HEIC，此时会明确提示「无法处理」而不是假装成功。',
  },
];

export const PRIVACY_PROMISES: Array<{ title: string; body: string }> = [
  {
    title: '不上传、不联网',
    body: '所有解析与清理都在你的浏览器进程内完成，没有任何 fetch / XHR 指向外部服务。你可以断开网络后再使用本工具，功能完全一样。',
  },
  {
    title: '不写入持久存储',
    body: '图片只存在于内存与临时 ObjectURL 中。清理结果只有在你点击下载时才会落到磁盘，页面关闭即全部消失。',
  },
  {
    title: '不接入分析脚本',
    body: '没有 Google Analytics、没有像素追踪、没有第三方字体 CDN。构建产物里只有本仓库自己的代码。',
  },
  {
    title: '输出必须被验证',
    body: '每个导出文件都会被重新读回、重新解析、重新解码。只有「重新解析后确实不存在」的字段才会计入「已清除」。',
  },
];

export const LIMITS: string[] = [
  '像素级隐写：把数据编码进像素最低有效位（LSB）的做法无法通过元数据清理去除，本工具也不做隐写检测。需要彻底排除时，只能重新拍摄或使用重编码 + 有损压缩。',
  '未解析的私有块：某些设备的厂商私有块（MakerNote）内部结构不公开。本工具会把整个块移除，但无法逐一列出其中字段。',
  '已被裁剪的字段：如果你先用其他软件删除了 EXIF，本工具看不到「曾经有过什么」，只能报告当前状态。',
  '平台二次写入：图片上传到社交平台或云盘后，对方可能重新写入自己的元数据。这一步不在本工具控制范围内。',
  '重编码路径的差异：TIFF / BMP / AVIF / HEIC 会经 Canvas 重编码为 PNG，格式一定改变，透明通道与色彩位深可能有规范化差异。',
  '超大文件：超过约 40 兆像素的图片会被拒绝深度处理，以避免浏览器标签页崩溃。',
];

export const TIPS: string[] = [
  '分享前先在原图上跑一次检查：GPS 坐标是最容易被忽视、也最难撤回的信息。',
  '聊天软件"原图"发送通常保留完整 EXIF，压缩发送才会去掉大部分元数据，但两种方式都不该被当作隐私保护手段。',
  '截屏往往比原图更安全：截屏重新生成像素，天然不带相机元数据（但会带屏幕分辨率等信息）。',
  '如果图片同时包含人脸与地理位置，风险要按"两者叠加"评估，而不是分开看。',
  '清理后仍建议检查画面本身：门牌号、快递单、工牌、镜子反光里的信息，元数据工具帮不上忙。',
];
