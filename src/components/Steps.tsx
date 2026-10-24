const STEP_LABELS = ['上传图片', '检查元数据', '清理', '导出'];

export function Steps({ current }: { current: number }) {
  return (
    <nav className="steps" aria-label="处理流程">
      {STEP_LABELS.map((label, i) => (
        <span key={label} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <span className={`step${i <= current ? ' step--active' : ''}`} aria-current={i === current ? 'step' : undefined}>
            <span className="step-num" aria-hidden>
              {i < current ? '✓' : i + 1}
            </span>
            {label}
          </span>
          {i < STEP_LABELS.length - 1 && <span className="step-sep" aria-hidden />}
        </span>
      ))}
    </nav>
  );
}
