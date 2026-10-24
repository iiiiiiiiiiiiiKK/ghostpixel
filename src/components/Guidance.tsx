import { IconAlert, IconCheck } from './icons.tsx';

export function Guidance({ limits, tips }: { limits: string[]; tips: string[] }) {
  return (
    <section className="section" aria-labelledby="limits-title">
      <div className="section-head">
        <h2 id="limits-title">已知限制与使用建议</h2>
        <p>把限制写清楚，比夸大能力更有用。下面每一条都是本工具当前的真实边界。</p>
      </div>
      <div className="grid-2">
        <div className="panel">
          <h3>
            <IconAlert style={{ color: 'var(--warn)' }} /> 已知限制
          </h3>
          <ul>
            {limits.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </div>
        <div className="panel">
          <h3>
            <IconCheck style={{ color: 'var(--ok)' }} /> 使用建议
          </h3>
          <ul>
            {tips.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
