import { strategyChips, type CampaignResult } from "@funded/shared";

/**
 * The four strategy choices as colour-coded chips. Same colours everywhere:
 * green/amber/red for the goal's risk, orange for generous rewards, teal for
 * "spread the word", blue for "friends back", purple for a video launch.
 */
export function StrategyChips({ c, compact = false, className = "" }: { c: CampaignResult; compact?: boolean; className?: string }) {
  const chips = strategyChips(c);
  return (
    <div className={`strategy${compact ? " compact" : ""} ${className}`.trim()}>
      {chips.map((ch) => (
        <span key={ch.key} className={`strat ${ch.tone}`} title={ch.label}>
          {compact ? ch.short : ch.label}
        </span>
      ))}
    </div>
  );
}
