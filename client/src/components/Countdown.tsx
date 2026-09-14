import { formatClock } from "@funded/shared";
import { useNow } from "../lib/socket";

export function Countdown({
  endsAt,
  expired,
  huge = false,
}: {
  endsAt: number | null;
  expired: boolean;
  huge?: boolean;
}) {
  const now = useNow(250);
  const ms = endsAt == null ? 0 : Math.max(0, endsAt - now);
  const warn = ms > 0 && ms <= 15_000;
  const cls = `countdown num${warn ? " warn" : ""}${huge ? " huge" : ""}`;
  if (endsAt == null) return <span className={cls}>{expired ? "0:00" : "—"}</span>;
  return (
    <span className={cls} aria-label="Time left">
      {formatClock(ms)}
    </span>
  );
}
