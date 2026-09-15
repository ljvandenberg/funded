import { formatClock, type CampaignResult } from "@funded/shared";
import { Badges } from "./Badge";
import { StrategyChips } from "./Strategy";
import { ProgressBar } from "./ProgressBar";

export type ShareState = "available" | "shared-this" | "used" | "own" | "locked";


export function CampaignCard({
  c,
  now,
  isOwn,
  myCoins,
  canAdd,
  onAdd,
  shareState,
  sharedName,
  onShare,
  inputsOpen,
  justLaunched = false,
}: {
  c: CampaignResult;
  now: number;
  isOwn: boolean;
  myCoins: number;
  canAdd: boolean;
  onAdd: () => void;
  shareState: ShareState;
  sharedName?: string;
  onShare: () => void;
  inputsOpen: boolean;
  justLaunched?: boolean;
}) {
  const locked = !c.launched;
  const untilLaunch = c.launchesAt != null ? Math.max(0, c.launchesAt - now) : 0;
  const ownBlocked = isOwn && c.network === "share";

  return (
    <article className={`card campaign${c.pinned ? " pinned" : ""}${locked ? " locked" : ""}${isOwn ? " own" : ""}${justLaunched ? " just-launched" : ""}`}>
      <div className="row between">
        <Badges badges={c.badges.filter((b) => b === "New")} sharedBy={c.sharedBy} own={isOwn} />
        {justLaunched && <span className="live-pill">Live</span>}
      </div>
      <StrategyChips c={c} />
      <div>
        <div className="name">{c.name}</div>
        <p className="pitch">{c.pitch}</p>
      </div>
      <div className="meta">
        <span>{c.backers} backers</span>
        <span>{c.shares} shares</span>
      </div>
      {locked ? (
        <div className="lock-line">
          Building an audience · Launches in <span className="num">{formatClock(untilLaunch)}</span>
        </div>
      ) : (
        <>
          <ProgressBar progress={c.progress} funded={c.funded} />
          <div className="coins-line">
            <span className="raised num">
              {c.raised} / {c.goal} coins
            </span>
            {c.funded && <span className="tiny bold" style={{ color: "var(--good)" }}>Goal reached</span>}
          </div>
        </>
      )}
      {isOwn && !ownBlocked && (
        <div className="warn">Your own campaign: counts toward the goal, no return, no validation</div>
      )}
      {ownBlocked && <div className="warn">Your team chose to share, not to back. Get others to share it!</div>}
      <div className="actions">
        {!ownBlocked && (
          <>
            <span className="mine-label tiny muted">Your coins</span>
            <span className="mine num" aria-label="Your coins here">
              {myCoins}
            </span>
            <button
              className="btn icon primary"
              onClick={onAdd}
              disabled={!inputsOpen || locked || !canAdd}
              aria-label={`Add a coin to ${c.name}`}
            >
              +
            </button>
          </>
        )}
        <span className="grow" />
        {shareState !== "own" && (
          <button
            className={`btn small${shareState === "shared-this" ? " shared" : ""}`}
            onClick={onShare}
            disabled={!inputsOpen || shareState !== "available"}
            title={shareState === "used" && sharedName ? `You shared ${sharedName}` : undefined}
            aria-label={`Share ${c.name}`}
          >
            {shareState === "shared-this" ? "Shared ✓" : shareState === "used" ? `Shared ✓ ${sharedName ?? ""}` : "Share"}
          </button>
        )}
      </div>
    </article>
  );
}
