import type { FormatRow } from '../content.ts';

export function FormatMatrix({ rows }: { rows: FormatRow[] }) {
  return (
    <section className="section" aria-labelledby="formats-title">
      <div className="section-head">
        <h2 id="formats-title">支持格式与清理能力</h2>
        <p>
          不同格式的元数据存放在完全不同的结构里，因此「能做到什么」必须逐格式说明。
          下表是实际实现的行为，不是营销描述。
        </p>
      </div>
      <div className="panel" style={{ padding: 0 }}>
        <div className="table-scroll">
          <table className="matrix">
            <caption className="visually-hidden">各图片格式的元数据读取与清理能力对照</caption>
            <thead>
              <tr>
                <th scope="col">格式</th>
                <th scope="col">可读取的元数据</th>
                <th scope="col">清理方式</th>
                <th scope="col">路径</th>
                <th scope="col">边界说明</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.format}>
                  <th scope="row">
                    {r.format}
                    <div style={{ fontSize: 11, color: 'var(--text-faint)', fontWeight: 400 }}>{r.extensions}</div>
                  </th>
                  <td>{r.read}</td>
                  <td>{r.strip}</td>
                  <td>
                    <span className={`badge ${r.strategy === '无损剥离' ? 'badge--ok' : 'badge--medium'}`}>{r.strategy}</span>
                  </td>
                  <td>{r.caveat}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
