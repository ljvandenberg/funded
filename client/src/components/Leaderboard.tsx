export interface BoardRow {
  id: string;
  label: string;
  sub?: string;
  value: string;
  me?: boolean;
}

export function Leaderboard({ rows }: { rows: BoardRow[] }) {
  return (
    <div className="board">
      {rows.map((r, i) => (
        <div key={r.id} className={`rowl${r.me ? " me" : ""}`}>
          <span className="rank num">{i + 1}</span>
          <span className="grow">
            <span className="bold">{r.label}</span>
            {r.sub && <span className="muted small"> · {r.sub}</span>}
          </span>
          <span className="val">{r.value}</span>
        </div>
      ))}
    </div>
  );
}
