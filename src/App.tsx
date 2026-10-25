import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { zipSync } from 'fflate';
import { AUTHOR_X, FORMAT_MATRIX, LIMITS, PRIVACY_PROMISES, REPO_URL, TIPS } from './content.ts';
import { analyzeBytes, cleanImage, DEFAULT_CLEAN_OPTIONS, describePlan, type AnalyzeResult } from './lib/pipeline.ts';
import { createPreviewUrl, formatBytes, tooManyPixels } from './lib/image.ts';
import type { CleanOutcome } from './lib/pipeline.ts';
import { Dropzone } from './components/Dropzone.tsx';
import { ImageCard } from './components/ImageCard.tsx';
import { FormatMatrix } from './components/FormatMatrix.tsx';
import { Guidance } from './components/Guidance.tsx';
import { Header } from './components/Header.tsx';
import { Toast, type ToastMessage } from './components/Toast.tsx';
import { IconCheck, IconEraser, IconScan, IconShield, IconTrash, IconZip, IconAlert, IconInfo, IconX } from './components/icons.tsx';
import { Steps } from './components/Steps.tsx';

export interface ItemState {
  id: string;
  name: string;
  size: number;
  type: string;
  /** 原始字节（内存中，不落盘）。 */
  blob: Blob;
  analysis?: AnalyzeResult;
  outcome?: CleanOutcome;
  status: 'reading' | 'analyzing' | 'ready' | 'cleaning' | 'done' | 'error';
  error?: string;
  stage: string;
}

const MAX_FILE_BYTES = 40 * 1024 * 1024;
const MAX_FILES = 12;

let seq = 0;
const nextId = () => `f${++seq}-${Math.random().toString(36).slice(2, 8)}`;

export default function App() {
  const [items, setItems] = useState<ItemState[]>([]);
  const [keepIcc, setKeepIcc] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [theme, setTheme] = useState<'system' | 'light' | 'dark'>('system');
  const [networkCalls] = useState(0);

  const previews = useRef(new Map<string, { url: string; revoke: () => void }>());
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const pushToast = useCallback((text: string, tone: ToastMessage['tone'] = 'info') => {
    const id = nextId();
    setToasts((t) => [...t, { id, text, tone }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3600);
  }, []);

  /* ---------- 主题 ---------- */
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
  }, [theme]);

  /* ---------- 预览 URL 生命周期 ---------- */
  const ensurePreview = useCallback((id: string, bytes: Uint8Array, mime: string) => {
    const existing = previews.current.get(id);
    if (existing) return existing.url;
    const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: mime });
    const p = createPreviewUrl(blob);
    previews.current.set(id, p);
    return p.url;
  }, []);

  /** 卸载 / 清空时释放所有 ObjectURL，避免内存泄漏。 */
  useEffect(() => {
    const map = previews.current;
    return () => {
      for (const p of map.values()) p.revoke();
      map.clear();
    };
  }, []);

  /* ---------- 添加文件 ---------- */
  const addFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      const accepted = files.slice(0, MAX_FILES);
      if (files.length > MAX_FILES) {
        pushToast(`一次最多处理 ${MAX_FILES} 张，已忽略其余 ${files.length - MAX_FILES} 个文件。`, 'warn');
      }
      const created: ItemState[] = accepted.map((f) => ({
        id: nextId(),
        name: f.name,
        size: f.size,
        type: f.type,
        blob: f,
        status: 'reading',
        stage: '读取文件',
      }));

      setItems((prev) => [...prev, ...created]);

      for (const [i, item] of created.entries()) {
        const file = accepted[i];
        try {
          if (file.size === 0) {
            setItems((prev) =>
              prev.map((p) => (p.id === item.id ? { ...p, status: 'error', error: '文件内容为空（0 字节），无法处理。' } : p)),
            );
            continue;
          }
          if (file.size > MAX_FILE_BYTES) {
            setItems((prev) =>
              prev.map((p) =>
                p.id === item.id
                  ? { ...p, status: 'error', error: `文件 ${formatBytes(file.size)} 超过 ${formatBytes(MAX_FILE_BYTES)} 上限，已跳过。` }
                  : p,
              ),
            );
            continue;
          }
          setItems((prev) => prev.map((p) => (p.id === item.id ? { ...p, status: 'analyzing', stage: '解析容器结构' } : p)));
          const buf = new Uint8Array(await file.arrayBuffer());
          const analysis = await analyzeBytes(buf, { keepIcc });

          if (analysis.scan.kind === 'unknown') {
            setItems((prev) =>
              prev.map((p) =>
                p.id === item.id
                  ? { ...p, status: 'error', error: analysis.scan.warnings[0] ?? '无法识别的文件格式。' }
                  : p,
              ),
            );
            continue;
          }
          if (tooManyPixels(analysis.scan.width ?? 0, analysis.scan.height ?? 0)) {
            setItems((prev) =>
              prev.map((p) =>
                p.id === item.id
                  ? { ...p, status: 'error', error: `图像像素数过大（${analysis.scan.width}×${analysis.scan.height}），为保护浏览器性能已跳过。` }
                  : p,
              ),
            );
            continue;
          }
          ensurePreview(item.id, buf, analysis.mime);
          setItems((prev) => prev.map((p) => (p.id === item.id ? { ...p, status: 'ready', analysis, stage: '' } : p)));
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          setItems((prev) =>
            prev.map((p) => (p.id === item.id ? { ...p, status: 'error', error: `处理失败：${msg}` } : p)),
          );
        }
      }
    },
    [ensurePreview, keepIcc, pushToast],
  );

  /* ---------- 单张清理 ---------- */
  const cleanOne = useCallback(
    async (item: ItemState, silent = false): Promise<ItemState> => {
      if (!item.analysis) return item;
      setItems((prev) => prev.map((p) => (p.id === item.id ? { ...p, status: 'cleaning', stage: '移除元数据并复检' } : p)));
      try {
        const outcome = await cleanImage({ name: item.name, blob: item.blob }, item.analysis, {
          ...DEFAULT_CLEAN_OPTIONS,
          keepIcc,
        });
        const next: ItemState = { ...item, outcome, status: 'done' };
        if (outcome.output) ensurePreview(item.id, outcome.output, outcome.outputMime);
        setItems((prev) => prev.map((p) => (p.id === item.id ? next : p)));
        if (!silent) {
          if (outcome.ok) pushToast(`${item.name}：已清理并通过复检验证`, 'ok');
          else pushToast(`${item.name}：${outcome.error ?? '清理失败'}`, 'error');
        }
        return next;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const next: ItemState = { ...item, status: 'error', error: msg };
        setItems((prev) => prev.map((p) => (p.id === item.id ? next : p)));
        if (!silent) pushToast(`清理失败：${msg}`, 'error');
        return next;
      }
    },
    [ensurePreview, keepIcc, pushToast],
  );

  const cleanAll = useCallback(async () => {
    const targets = itemsRef.current.filter((i) => i.status === 'ready' || i.status === 'done');
    if (targets.length === 0) return;
    setBusy(true);
    try {
      for (const t of targets) {
        // 已清理过的跳过，避免重复处理。
        if (t.status === 'done' && t.outcome?.ok) continue;
        await cleanOne(t, true);
      }
      pushToast(`已完成 ${targets.length} 张图片的清理`, 'ok');
    } finally {
      setBusy(false);
    }
  }, [cleanOne, pushToast]);

  /* ---------- 下载 ---------- */
  const downloadOne = useCallback((item: ItemState) => {
    const out = item.outcome;
    if (!out?.output || !out.outputName) {
      pushToast('没有可下载的结果：清理未通过验证。', 'error');
      return;
    }
    const blob = new Blob([out.output.slice().buffer as ArrayBuffer], { type: out.outputMime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = out.outputName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // 下载触发后立刻释放，避免 URL 常驻内存。
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    pushToast(`已保存 ${out.outputName}`, 'ok');
  }, [pushToast]);

  const cleanItems = useMemo(() => items.filter((i) => i.status === 'done' && i.outcome?.ok), [items]);

  const downloadAll = useCallback(async () => {
    if (cleanItems.length === 0) {
      pushToast('还没有通过验证的清理结果可以打包。', 'warn');
      return;
    }
    const files: Record<string, Uint8Array> = {};
    const used = new Set<string>();
    const lines: string[] = [];
    for (const item of cleanItems) {
      const out = item.outcome!;
      let name = out.outputName!;
      let n = 2;
      while (used.has(name)) {
        const dot = out.outputName!.lastIndexOf('.');
        name = `${out.outputName!.slice(0, dot)}-${n++}${out.outputName!.slice(dot)}`;
      }
      used.add(name);
      files[name] = out.output!;
      const v = out.verification;
      lines.push(
        [
          `文件名: ${name}`,
          `来源: ${item.name}`,
          `格式: ${item.analysis?.label ?? '?'} → ${out.outputMime}`,
          `尺寸: ${v?.widthBefore ?? '?'}×${v?.heightBefore ?? '?'} → ${v?.widthAfter ?? '?'}×${v?.heightAfter ?? '?'}`,
          `大小: ${formatBytes(item.size)} → ${formatBytes(out.output!.byteLength)}`,
          `像素重编码: ${out.transcoded ? '是（有损路径）' : '否（无损剥离）'}`,
          `已确认清除字段: ${v?.cleared.length ?? 0} 个`,
          `无法验证: ${(v?.unverifiable ?? []).join(' / ')}`,
          '',
        ].join('\n'),
      );
    }
    const readme = [
      'GhostPixel 清理结果',
      `导出时间: ${new Date().toISOString()}`,
      '',
      '说明：本清单由 GhostPixel 在本地生成。每个文件在导出前都被重新解析与解码验证。',
      '「已确认清除」= 重新解析后该字段确实不存在；「无法验证」= 本工具无法给出结论的部分。',
      '',
      ...lines,
    ].join('\n');
    files['清理报告.txt'] = new TextEncoder().encode(readme);

    try {
      const zipped = zipSync(files, { level: 6 });
      const blob = new Blob([zipped.slice().buffer as ArrayBuffer], { type: 'application/zip' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ghostpixel-${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1500);
      pushToast(`已打包 ${cleanItems.length} 个文件（含清理报告）`, 'ok');
    } catch (e) {
      pushToast(`打包失败：${e instanceof Error ? e.message : String(e)}`, 'error');
    }
  }, [cleanItems, pushToast]);

  /* ---------- 清空 ---------- */
  const clearAll = useCallback(() => {
    for (const p of previews.current.values()) p.revoke();
    previews.current.clear();
    setItems([]);
    pushToast('工作区已清空，所有预览与结果已从内存释放。', 'ok');
  }, [pushToast]);

  const removeOne = useCallback((id: string) => {
    const p = previews.current.get(id);
    if (p) {
      p.revoke();
      previews.current.delete(id);
    }
    setItems((prev) => prev.filter((i) => i.id !== id));
  }, []);

  /* ---------- 键盘 ---------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
      if (typing) return;
      if (e.key === 'c' && (e.metaKey || e.ctrlKey) && e.shiftKey) {
        e.preventDefault();
        void cleanAll();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cleanAll]);

  const activeCount = items.filter((i) => i.status !== 'error').length;
  const sensitiveCount = items.reduce((n, i) => n + (i.analysis?.report.highSensitiveCount ?? 0), 0);
  const hasGps = items.some((i) => i.analysis?.report.hasGps);
  const currentStep = items.length === 0 ? 0 : cleanItems.length > 0 ? 3 : sensitiveCount > 0 || activeCount > 0 ? 1 : 0;

  return (
    <div className="shell">
      <Header
        theme={theme}
        onThemeChange={setTheme}
        onClearAll={clearAll}
        canClear={items.length > 0}
      />

      <main className="container" id="main">
        <section className="hero" aria-labelledby="hero-title">
          <h1 id="hero-title">看看你的图片里，藏着哪些不该被看到的信息</h1>
          <p className="hero-lede">
            GhostPixel 在<span className="lede-strong">你的浏览器本地</span>读取照片的 EXIF、GPS、拍摄时间与设备型号，
            然后把这些元数据整块移除，并<span className="lede-strong">重新解析导出文件</span>确认真的清掉了。
            <br />
            图片不会上传到任何服务器，处理完关掉页面就什么都不剩。
          </p>
          <div className="pill-row">
            <span className="pill pill--ok">
              <IconCheck /> 全程离线处理
            </span>
            <span className="pill">
              <IconScan /> JPEG · PNG · WebP · GIF 无损剥离
            </span>
            <span className="pill">导出前逐张复检</span>
            <span className="pill" data-testid="network-calls">
              外部网络请求：{networkCalls} 次
            </span>
          </div>
          <Steps current={currentStep} />
        </section>

        <Dropzone onFiles={addFiles} disabled={busy} />

        {items.length === 0 ? (
          <>
            <div className="empty" style={{ marginTop: 16 }}>
              <h3>还没有图片</h3>
              <p>
                把图片拖到上面的区域，或者点「选择图片」开始。也可以先看看下面的格式支持表和清理边界说明，
                了解每种格式到底能做哪些事。
              </p>
            </div>
          </>
        ) : (
          <>
            <div className="toolbar">
              <span className="toolbar-title">
                共 {items.length} 张 · 检测到{' '}
                <strong style={{ color: 'var(--text)' }}>{sensitiveCount}</strong> 个敏感字段
                {hasGps && (
                  <>
                    {' · '}
                    <strong style={{ color: 'var(--danger)' }}>含 GPS 定位</strong>
                  </>
                )}
              </span>

              <label className="icon-btn" style={{ cursor: 'pointer', gap: 6 }} title="保留 ICC 色彩配置">
                <input
                  type="checkbox"
                  checked={keepIcc}
                  onChange={(e) => {
                    setKeepIcc(e.target.checked);
                    pushToast(
                      e.target.checked
                        ? '已开启保留 ICC：颜色更准确，但配置文件内可能写入来源设备名称。改动会在下次分析时生效。'
                        : '已关闭保留 ICC：清理会更彻底，颜色可能有极轻微变化。',
                      'info',
                    );
                  }}
                  style={{ margin: 0, accentColor: 'var(--accent)' }}
                />
                保留 ICC
              </label>

              <button className="btn" onClick={cleanAll} disabled={busy || activeCount === 0}>
                {busy ? <span className="spinner" /> : <IconEraser />}
                {busy ? '清理中…' : '一键清理全部'}
              </button>
              <button className="btn btn--primary" onClick={downloadAll} disabled={cleanItems.length === 0}>
                <IconZip />
                打包下载（{cleanItems.length}）
              </button>
              <button className="btn btn--danger" onClick={clearAll}>
                <IconTrash />
                清空工作区
              </button>
            </div>

            <div className="card-list">
              {items.map((item) => (
                <ImageCard
                  key={item.id}
                  item={item}
                  previewUrl={previews.current.get(item.id)?.url}
                  onClean={() => void cleanOne(item)}
                  onDownload={() => downloadOne(item)}
                  onRemove={() => removeOne(item.id)}
                />
              ))}
            </div>
          </>
        )}

        <section className="section" aria-labelledby="plan-title">
          <div className="section-head">
            <h2 id="plan-title">处理前后会发生什么</h2>
            <p>
              下面是本工具对每张图实际执行的策略。JPEG / PNG / WebP / GIF 走「整块删除」路径，
              像素数据原样复制，因此不重新压缩、不掉画质；其余格式必须重编码，会改变格式。
            </p>
          </div>
          <div className="grid-2">
            <div className="panel">
              <h3>
                <IconCheck style={{ color: 'var(--ok)' }} /> 会移除的内容
              </h3>
              <ul>
                <li>
                  <strong>EXIF / GPS</strong>：拍摄坐标、海拔、方向、拍摄时间、机身与镜头序列号、相机所有者
                </li>
                <li>
                  <strong>XMP / IPTC</strong>：作者、版权、编辑软件、历史记录
                </li>
                <li>
                  <strong>PNG 文本块</strong>：tEXt / zTXt / iTXt 里的软件名、作者、备注、时间
                </li>
                <li>
                  <strong>注释与扩展块</strong>：JPEG COM、GIF 注释/应用扩展、WebP EXIF/XMP 块
                </li>
                <li>
                  <strong>文件尾部附加数据</strong>：EOI / IEND / RIFF 之后不属于图像本身的内容
                </li>
              </ul>
            </div>
            <div className="panel">
              <h3>
                <IconAlert style={{ color: 'var(--warn)' }} /> 有意保留的内容
              </h3>
              <ul>
                <li>
                  <strong>JFIF(APP0) / Adobe(APP14)</strong>：只含像素密度与色彩变换类型，是解码必需
                </li>
                <li>
                  <strong>量化表 / 霍夫曼表 / 帧头</strong>：没有它们图片无法解码
                </li>
                <li>
                  <strong>IHDR / PLTE / tRNS / IDAT</strong>：PNG 的像素与透明信息
                </li>
                <li>
                  <strong>ICC 色彩配置</strong>：默认移除；如勾选「保留 ICC」则会留下，颜色更准但配置文件内可能含设备名
                </li>
              </ul>
            </div>
          </div>
        </section>

        <FormatMatrix rows={FORMAT_MATRIX} />

        <section className="section" aria-labelledby="privacy-title">
          <div className="section-head">
            <h2 id="privacy-title">隐私承诺</h2>
            <p>这些不是宣传语，而是可以在 DevTools 的 Network 面板里自己验证的行为。</p>
          </div>
          <div className="grid-2">
            {PRIVACY_PROMISES.map((p) => (
              <div className="panel" key={p.title}>
                <h3>
                  <IconCheck style={{ color: 'var(--ok)' }} /> {p.title}
                </h3>
                <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>{p.body}</p>
              </div>
            ))}
          </div>
        </section>

        <Guidance limits={LIMITS} tips={TIPS} />

        <section className="section" aria-labelledby="plan2-title">
          <div className="section-head">
            <h2 id="plan2-title">为什么不能宣称「清除所有隐藏信息」</h2>
            <p>
              这句话很重要，所以我们把它写在这里而不是藏在角落：元数据清理只能处理「已知结构里的已知字段」。
              任何声称 100% 清除的工具，都在某个它没考虑到的地方说了谎。
            </p>
          </div>
          <div className="alert alert--warn">
            <IconInfo />
            <div>
              <div className="alert-title">本工具的能量边界</div>
              <ul>
                <li>
                  <strong>已检测</strong>：容器结构中被识别出的每个块、以及解析器能展开的每个字段。这些会逐条列出。
                </li>
                <li>
                  <strong>已清理</strong>：导出文件被重新解析后，该字段确实不再出现。这是可以验证的事实。
                </li>
                <li>
                  <strong>无法验证</strong>：像素级隐写、未公开的私有块内部结构、平台侧的二次写入。
                  我们只能说「这些不在本次验证范围内」，而不是「已经清掉了」。
                </li>
              </ul>
            </div>
          </div>
        </section>
      </main>

      <footer className="footer">
        <div className="container footer-inner">
          <div className="footer-row">
            <span className="footer-brand">
              <IconShield className="footer-mark" />
              GhostPixel
            </span>
            <span className="footer-tag">图片元数据检查与清理</span>
            <span className="footer-chip">MIT License</span>
          </div>
          <div className="footer-row footer-row--links">
            <a href={REPO_URL} target="_blank" rel="noreferrer noopener">
              源码与已知限制
            </a>
            <span className="footer-sep" aria-hidden>
              /
            </span>
            <a href={AUTHOR_X.url} target="_blank" rel="noreferrer noopener">
              作者 𝕏 {AUTHOR_X.handle}
            </a>
          </div>
          <div className="footer-row footer-row--note">
            <span className="footer-note">所有处理都在你的设备上完成 · 图片不会离开浏览器</span>
          </div>
        </div>
      </footer>

      <Toast toasts={toasts} onDismiss={(id) => setToasts((t) => t.filter((x) => x.id !== id))} />
    </div>
  );
}

/** 供测试与外部引用。 */
export { describePlan, IconX };
