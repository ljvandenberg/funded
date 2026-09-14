/**
 * The goal is the 100% mark. The track runs to 130% so over-funding keeps
 * growing past the tick.
 */
export function ProgressBar({
  progress,
  funded,
  big = false,
  stampNotFunded = false,
  noStamp = false,
}: {
  progress: number;
  funded: boolean;
  big?: boolean;
  stampNotFunded?: boolean;
  noStamp?: boolean;
}) {
  const MAX = 1.3;
  const width = (Math.min(progress, MAX) / MAX) * 100;
  const tick = (1 / MAX) * 100;
  return (
    <div className="bar-wrap">
      <div className={`bar${funded ? " funded" : ""}${big ? " big" : ""}`} role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={130}>
        <div className="fill" style={{ width: `${width}%` }} />
        <div className="tick" style={{ left: `calc(${tick}% - 1px)` }} aria-hidden />
      </div>
      {funded && !noStamp && <div className={`stamp${big ? " big" : ""}`}>FUNDED</div>}
      {!funded && stampNotFunded && !noStamp && <div className={`stamp bad${big ? " big" : ""}`}>NOT FUNDED</div>}
    </div>
  );
}
