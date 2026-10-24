import { useId, useState } from 'react';
import type { ItemState } from '../App.tsx';
import { describePlan } from '../lib/pipeline.ts';
import { deltaLabel, formatBytes } from '../lib/image.ts';
import { IconAlert, IconCheck, IconDownload, IconEraser, IconInfo, IconPin, IconTrash } from './icons.tsx';
import type { MetaField } from '../lib/types.ts';

const SENS_LABEL: Record<MetaField['sensitivity'], string> = {
  high: '高敏感',
  medium: '需注意',
  low: '常规',
  none: '技术',
};

function Badge({ level }: { level: MetaField['sensitivity'] }) {
  if (level === 'none') return null;
  return <span className={`badge badge--${level}`}>{SENS_LABEL[level]}</span>;
}

export interface ImageCardProps {
  item: ItemState;
  previewUrl?: string;
  onClean: () => void;
  onDownload: () => void;
  onRemove: () => void;
}

export function ImageCard({ item, previewUrl, onClean, onDownload, onRemove }: ImageCardProps) {
  const [showSegments, setShowSegments] = useState(false);
  const detailsId = useId();
  const a = item.analysis;
  const out = item.outcome;
  const v = out?.verification;
  const hasHigh = (a?.report.highSensitiveCount ?? 0) > 0;

  const title = item.name;

  return (
    <article className={`card${hasHigh ? ' card--sensitive' : ''}`} data-testid="image-card">
      <div className="card-head">
        {previewUrl && <img className="thumb" src={previewUrl} alt="" aria-hidden />}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="card-title" title={title}>
            {title}
          </div>
          <div className="card-meta">
            {a ? (
              <>
                {a.label} · {a.scan.width ?? '?'}×{a.scan.height ?? '?'} · {formatBytes(item.size)}
              </>
            ) : (
              <>{formatBytes(item.size)}</>
            )}
          </div>
        </div>
        <div className="card-head-actions">
          <button className="btn btn--sm btn--ghost" onClick={onRemove} aria-label={`移除 ${title}`} title="移除">
            <IconTrash />
          </button>
        </div>
      </div>

      <div className="card-body card--split">
        <div className="preview-wrap">
          <div className="preview-frame">
            {previewUrl ? (
              <img src={previewUrl} alt={`${title} 的预览`} data-testid="preview" />
            ) : (
              <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>正在生成预览…</span>
            )}
          </div>
          <span className="preview-caption">
            {out?.ok ? '预览为清理后的输出' : '预览为原始图片'}
          </span>
        </div>

        <div style={{ display: 'grid', gap: 14, minWidth: 0 }}>
          {item.status === 'error' && (
            <div className="alert alert--danger" role="alert">
              <IconAlert />
              <div>
                <div className="alert-title">无法处理这张图片</div>
                {item.error}
              </div>
            </div>
          )}

          {(item.status === 'reading' || item.status === 'analyzing' || item.status === 'cleaning') && (
            <div className="alert">
              <span className="spinner" />
              <div>{item.stage || '处理中…'}</div>
            </div>
          )}

          {a && (
            <>
              {/* 敏感提示（清理成功后不再重复警告，避免误导） */}
              {a.report.hasGps && !out?.ok && (
                <div className="alert alert--danger">
                  <IconPin />
                  <div>
                    <div className="alert-title">这张图片带有 GPS 坐标</div>
                    {a.report.gps
                      ? `约 ${a.report.gps.latitude.toFixed(5)}, ${a.report.gps.longitude.toFixed(5)}。清理后会整块移除。`
                      : '检测到 GPS 元数据块，清理后会整块移除。'}
                  </div>
                </div>
              )}
              {!a.report.hasGps && hasHigh && !out?.ok && (
                <div className="alert alert--warn">
                  <IconAlert />
                  <div>
                    <div className="alert-title">发现 {a.report.highSensitiveCount} 个高敏感字段</div>
                    例如设备型号、序列号、拍摄时间、作者。这些都被标记在下面的表格里。
                  </div>
                </div>
              )}
              {a.report.fieldCount === 0 && a.scan.metadataCount === 0 && (
                <div className="alert alert--ok">
                  <IconCheck />
                  <div>
                    <div className="alert-title">没有发现可移除的元数据</div>
                    这张图片已经比较干净。你仍然可以点清理，但输出预期与输入基本相同。
                    {a.report.parserNote ? ` 解析器说明：${a.report.parserNote}` : ''}
                  </div>
                </div>
              )}
              {a.report.fieldCount === 0 && a.scan.metadataCount > 0 && (
                <div className="alert alert--warn">
                  <IconInfo />
                  <div>
                    <div className="alert-title">检测到元数据块，但无法展开为字段</div>
                    {a.report.parserNote ?? '这些数据位于不公开的私有结构中。清理会把整个块移除，但无法逐字段列出内容。'}
                  </div>
                </div>
              )}
              {a.scan.truncated && (
                <div className="alert alert--warn">
                  <IconAlert />
                  <div>
                    <div className="alert-title">文件结构可能已损坏</div>
                    {a.scan.warnings.join('；')}
                    清理仍会尝试执行，但导出结果可能无法完整解码——我们会验证后再决定是否提供下载。
                  </div>
                </div>
              )}

              {/* 元数据分组表格 */}
              {a.report.groups.length > 0 &&
                (out?.ok ? (
                  // 清理成功后，默认收起原始字段，只保留标题，避免误以为「还残留」。
                  <details className="meta-collapsed" data-testid="meta-cleared">
                    <summary>
                      清理前检测到的 {a.report.fieldCount} 个字段（已全部移除，点击可回看）
                    </summary>
                    <div className="meta-groups" style={{ marginTop: 10 }}>
                      {a.report.groups.map((g) => (
                        <section className="meta-group" key={g.id}>
                          <div className="meta-group-head">
                            <span className="dot dot--high" />
                            {g.title}
                            <span className="count">{g.fields.length} 项 · 已移除</span>
                          </div>
                          <table className="meta-table">
                            <tbody>
                              {g.fields.map((f) => (
                                <tr key={f.key}>
                                  <th scope="row">
                                    <span style={{ textDecoration: 'line-through', opacity: 0.75 }}>{f.label}</span>
                                  </th>
                                  <td>
                                    <span style={{ textDecoration: 'line-through', opacity: 0.6 }}>{f.value}</span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </section>
                      ))}
                    </div>
                  </details>
                ) : (
                  <div className="meta-groups" data-testid="meta-groups">
                    {a.report.groups.map((g) => (
                      <section className="meta-group" key={g.id}>
                        <div className="meta-group-head">
                          <span className={`dot dot--${g.id === 'gps' ? 'high' : g.fields.some((f) => f.sensitivity === 'high') ? 'high' : 'medium'}`} />
                          {g.title}
                          <span className="count">{g.fields.length} 项</span>
                        </div>
                        {g.description && <div className="meta-group-desc">{g.description}</div>}
                        <table className="meta-table">
                          <tbody>
                            {g.fields.map((f) => (
                              <tr key={f.key} className={f.sensitivity === 'high' ? 'is-flagged' : undefined}>
                                <th scope="row">
                                  {f.label} <Badge level={f.sensitivity} />
                                </th>
                                <td>
                                  {f.value}
                                  {f.note && <span className="meta-note">{f.note}</span>}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </section>
                    ))}
                  </div>
                ))}

              {/* 容器块结构 */}
              <div>
                <button
                  className="btn btn--sm btn--ghost"
                  onClick={() => setShowSegments((s) => !s)}
                  aria-expanded={showSegments}
                  aria-controls={detailsId}
                >
                  {showSegments ? '收起数据块结构' : `查看数据块结构（${a.scan.segments.length} 个块）`}
                </button>
                <p style={{ fontSize: 12.3, color: 'var(--text-muted)', marginTop: 6 }}>{describePlan(a.scan)}</p>
                {showSegments && (
                  <div className="seg-list" id={detailsId} style={{ marginTop: 8 }}>
                    {a.scan.segments.map((s, i) => (
                      <div className={`seg-row${s.action === 'strip' ? ' seg-row--strip' : ''}`} key={`${s.id}-${i}`}>
                        <span className="seg-id">{s.id}</span>
                        <span className="seg-label" title={s.note}>
                          {s.label}
                          {s.action === 'strip' ? ' · 将移除' : ''}
                        </span>
                        <span className="seg-size">{formatBytes(s.size)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 清理结果与对比 */}
              {out && (
                <>
                  {out.ok && v ? (
                    <div className="verify" data-testid="verify-ok">
                      <div className="verify-head">
                        <IconCheck style={{ color: 'var(--ok)' }} />
                        清理完成，并已通过复检验证
                      </div>
                      <div className="verify-grid">
                        <div className="verify-row">
                          <span className="k">已确认清除</span>
                          <span className="v">{v.cleared.length} 个字段</span>
                        </div>
                        <div className="verify-row">
                          <span className="k">残留字段</span>
                          <span className="v">{v.stillPresent.length} 个</span>
                        </div>
                        <div className="verify-row">
                          <span className="k">容器状态</span>
                          <span className="v">
                            {v.containerClean ? '无任何可移除数据块' : `仍有 ${v.remainingSegments.length} 个块`}
                          </span>
                        </div>
                        <div className="verify-row">
                          <span className="k">能否打开</span>
                          <span className="v">{v.reopenable ? v.reopenNote : `失败：${v.reopenNote}`}</span>
                        </div>
                        <div className="verify-row">
                          <span className="k">处理方式</span>
                          <span className="v">
                            {out.transcoded ? 'Canvas 重新编码（有损路径，格式可能改变）' : '无损剥离（像素原样复制）'}
                          </span>
                        </div>
                      </div>
                      <details>
                        <summary>无法验证的部分（{v.unverifiable.length} 项）</summary>
                        <ul>
                          {v.unverifiable.map((u) => (
                            <li key={u}>{u}</li>
                          ))}
                        </ul>
                      </details>
                    </div>
                  ) : (
                    <div className="verify verify--fail" data-testid="verify-fail" role="alert">
                      <div className="verify-head">
                        <IconAlert style={{ color: 'var(--danger)' }} />
                        未能给出可信的清理结果，因此不提供下载
                      </div>
                      <p style={{ fontSize: 12.8, margin: 0 }}>{out.error}</p>
                      {v && v.stillPresent.length > 0 && (
                        <p style={{ fontSize: 12.3, color: 'var(--text-muted)', marginTop: 6 }}>
                          残留字段：{v.stillPresent.slice(0, 8).join('、')}
                        </p>
                      )}
                    </div>
                  )}

                  <div className="compare" data-testid="compare">
                    <div className="compare-item">
                      <div className="compare-label">文件大小</div>
                      <div className="compare-values">
                        <span className="compare-before">{formatBytes(item.size)}</span>
                        <span className="compare-after">{formatBytes(out.output?.byteLength ?? 0)}</span>
                        <span className="compare-delta">{deltaLabel(item.size, out.output?.byteLength ?? 0)}</span>
                      </div>
                    </div>
                    <div className="compare-item">
                      <div className="compare-label">像素尺寸</div>
                      <div className="compare-values">
                        <span className="compare-before">
                          {v?.widthBefore ?? '?'}×{v?.heightBefore ?? '?'}
                        </span>
                        <span className="compare-after">
                          {v?.widthAfter ?? '?'}×{v?.heightAfter ?? '?'}
                        </span>
                        <span className="compare-delta">{v?.dimensionsMatch ? '一致' : '已变化'}</span>
                      </div>
                    </div>
                    <div className="compare-item">
                      <div className="compare-label">格式</div>
                      <div className="compare-values">
                        <span className="compare-before">{a.label}</span>
                        <span className="compare-after">{out.outputMime.replace('image/', '').toUpperCase()}</span>
                        <span className="compare-delta">{v?.formatMatch ? '未改变' : '已转换'}</span>
                      </div>
                    </div>
                  </div>
                </>
              )}

              {/* 操作 */}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  className="btn btn--primary"
                  onClick={onClean}
                  disabled={item.status === 'cleaning'}
                  data-testid="clean-button"
                >
                  {item.status === 'cleaning' ? <span className="spinner" /> : <IconEraser />}
                  {item.status === 'cleaning' ? '清理中…' : '清理这张'}
                </button>
                <button className="btn" onClick={onDownload} disabled={!out?.ok} data-testid="download-button">
                  <IconDownload />
                  下载清理后的图片
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </article>
  );
}
