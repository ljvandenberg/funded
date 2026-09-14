import { useEffect, useMemo, useState } from "react";
import {
  CASE_BY_ID,
  CONFIG,
  OBJECTIVE_LABEL,
  OBJECTIVE_SHORT,
  computeResults,
  formatClock,
  orderedCampaigns,
  playersOfTeam,
  revealView,
  sortTeamIds,
  type CampaignResult,
  type Game,
} from "@funded/shared";
import { getJoinUrl, useGame, useNow } from "../lib/socket";
import { Badges } from "../components/Badge";
import { Countdown } from "../components/Countdown";
import { Leaderboard } from "../components/Leaderboard";
import { ProgressBar } from "../components/ProgressBar";
import { QR } from "../components/QR";

export function Screen() {
  const game = useGame();
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", "dark");
    return () => document.documentElement.removeAttribute("data-theme");
  }, []);

  const toggleFs = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.();
  };

  if (!game) return <div className="screen"><h1>FUNDED</h1><p className="muted">Connecting…</p></div>;

  return (
    <div className={`screen${game.phase === "REVEAL" ? " reveal" : ""}`}>
      {game.phase === "LOBBY" && <LobbyScreen game={game} />}
      {game.phase === "BUILD" && <BuildScreen game={game} />}
      {game.phase === "MARKET" && <MarketScreen game={game} />}
      {game.phase === "REVEAL" && <RevealScreen game={game} />}
      <button className="btn small ghost fs-btn" onClick={toggleFs} aria-label="Toggle fullscreen">⛶</button>
    </div>
  );
}

function Top({ title, game, timer = true }: { title: string; game: Game; timer?: boolean }) {
  return (
    <div className="top">
      <div>
        <span className="brand">FUNDED</span>
        <h1>{title}</h1>
      </div>
      {timer && game.phaseEndsAt != null && <Countdown endsAt={game.phaseEndsAt} expired={game.timerExpired} huge />}
    </div>
  );
}

function cols(n: number) {
  return n <= 4 ? 2 : n <= 6 ? 3 : 4;
}

function LobbyScreen({ game }: { game: Game }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    getJoinUrl().then(setUrl);
  }, []);
  const teamIds = sortTeamIds(Object.keys(game.teams));
  const shortUrl = url.replace(/^https?:\/\//, "");
  return (
    <>
      <Top title="Join FUNDED" game={game} timer={false} />
      <div className="lobby-qr">
        <div className="qr">{url && <QR value={url} size={328} />}</div>
        <div className="stack">
          <p className="muted" style={{ fontSize: "1.3rem" }}>Scan the code or go to</p>
          <div className="join-url">{shortUrl}</div>
          <p className="muted" style={{ fontSize: "1.2rem" }}>Enter your name, pick a team. First in a team is the captain.</p>
          <p className="display num" style={{ fontSize: "1.4rem" }}>{Object.keys(game.players).length} joined</p>
        </div>
      </div>
      <div className="screen-grid" style={{ "--cols": cols(teamIds.length) } as React.CSSProperties}>
        {teamIds.map((id) => {
          const members = playersOfTeam(game, id);
          return (
            <div key={id} className="card team-tile stack tight">
              <div className="row between">
                <span className="status">Team {id.slice(1)}</span>
                <span className="muted">{CASE_BY_ID[game.teams[id].caseId].name}</span>
              </div>
              <div className="names">
                {members.map((p) => (
                  <span key={p.id}>{p.name}{p.isCaptain ? " ★" : ""}</span>
                ))}
                {members.length === 0 && <span className="muted">Waiting…</span>}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

function BuildScreen({ game }: { game: Game }) {
  const teamIds = sortTeamIds(Object.keys(game.teams));
  return (
    <>
      <Top title="Round 1 · Build your campaign" game={game} />
      <div className="screen-grid" style={{ "--cols": cols(teamIds.length) } as React.CSSProperties}>
        {teamIds.map((id) => {
          const t = game.teams[id];
          const cap = t.captainId ? game.players[t.captainId] : undefined;
          return (
            <div key={id} className={`card team-tile stack tight${t.lockedIn ? " accent" : ""}`}>
              <div className="row between">
                <span className="status">Team {id.slice(1)} · {CASE_BY_ID[t.caseId].name}</span>
              </div>
              <p className="muted">Captain: {cap?.name ?? "—"} · {playersOfTeam(game, id).length} members</p>
              <p className="status" style={{ color: t.lockedIn ? "var(--good)" : "var(--muted)" }}>{t.lockedIn ? "Locked in ✓" : "Deciding…"}</p>
            </div>
          );
        })}
      </div>
    </>
  );
}

function MarketScreen({ game }: { game: Game }) {
  const now = useNow(400);
  const results = useMemo(() => computeResults(game, now), [game, now]);
  const cards = useMemo(() => orderedCampaigns(results), [results]);
  const launching = cards.find((c) => c.prep === "audience" && game.teams[c.teamId].launchedAt != null && now - game.teams[c.teamId].launchedAt! < CONFIG.launchBannerMs);
  const totalPlaced = cards.reduce((a, c) => a + c.placed, 0);
  return (
    <>
      <Top title="Round 2 · The market" game={game} />
      {launching && <div className="launch-banner">🚀 Just launched: {launching.name}</div>}
      {game.timerExpired && <div className="banner" style={{ fontSize: "1.4rem" }}>Market closed</div>}
      <div className="screen-grid" style={{ "--cols": cols(cards.length) } as React.CSSProperties}>
        {cards.map((c) => (
          <ScreenCard key={c.teamId} c={c} now={now} game={game} />
        ))}
      </div>
      <p className="muted center num">{totalPlaced} of {results.totalCoins} coins placed</p>
    </>
  );
}

function ScreenCard({ c, now, game }: { c: CampaignResult; now: number; game: Game }) {
  const t = game.teams[c.teamId];
  const flash = t.lastSharedAt != null && now - t.lastSharedAt < 1500;
  const untilLaunch = c.launchesAt != null ? Math.max(0, c.launchesAt - now) : 0;
  return (
    <div className={`card campaign${c.pinned ? " pinned" : ""}${!c.launched ? " locked" : ""}${flash ? " flash" : ""}`}>
      <Badges badges={c.badges} sharedBy={c.sharedBy} />
      <div>
        <div className="name">{c.name}</div>
        <p className="pitch muted">{c.pitch}</p>
      </div>
      {c.launched ? (
        <>
          <ProgressBar progress={c.progress} funded={c.funded} big />
          <div className="coins-line">
            <span className="raised num">{c.raised} / {c.goal}</span>
            <span className="muted num">{c.backers} backers · {c.shares} shares · {c.multiplier.toFixed(1)}×</span>
          </div>
        </>
      ) : (
        <div className="lock-line" style={{ fontSize: "1.3rem" }}>Building an audience · Launches in <span className="num">{formatClock(untilLaunch)}</span></div>
      )}
    </div>
  );
}

const GOAL_WORD = { low: "Low", medium: "Medium", high: "High" } as const;
const REWARD_WORD = { modest: "Modest", generous: "Generous" } as const;
const NETWORK_WORD = { back: "Friends back", share: "Friends share" } as const;
const PREP_WORD = { now: "Launched now", audience: "Built audience" } as const;

function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "good" | "bad" | "coin" }) {
  return (
    <div className={`stat${tone ? " tone-" + tone : ""}`}>
      <span className="stat-v num">{value}</span>
      <span className="stat-l">{label}</span>
    </div>
  );
}

function RevealScreen({ game }: { game: Game }) {
  const results = useMemo(() => computeResults(game, Date.now()), [game]);
  const view = revealView(game);
  const order = results.campaignOrder;
  const n = order.length;
  const step = game.revealStep;
  const all = order.map((id) => results.campaigns[id]);
  const fundedCount = all.filter((c) => c.funded).length;
  const totalPlaced = all.reduce((a, c) => a + c.placed, 0);

  if (view.showLessons) {
    return (
      <>
        <Top title="Two lessons" game={game} timer={false} />
        <div className="stat-strip">
          <Stat label="campaigns funded" value={`${fundedCount} / ${n}`} tone="good" />
          <Stat label="coins placed" value={`${totalPlaced} / ${results.totalCoins}`} tone="coin" />
          <Stat label="shares given" value={all.reduce((a, c) => a + c.shares, 0)} />
          <Stat label="coins that returned nothing" value={all.filter((c) => !c.funded).reduce((a, c) => a + c.placed, 0)} tone="bad" />
        </div>
        <div className="lessons">
          {!results.lessons.some((l) => l.key === "funded-not-validated") && (
            <div className="card lesson muted-lesson stack rise">
              <span className="eyebrow">Lesson 1 · not triggered this round</span>
              <h2>Funded, but not validated</h2>
              <p>No funded campaign got half or more of its coins from its own team. Enerchi Bites did: it hit its goal, but the money came from friends and family, so the market never spoke.</p>
            </div>
          )}
          {!results.lessons.some((l) => l.key === "goal-decides") && (
            <div className="card lesson muted-lesson stack rise">
              <span className="eyebrow">Lesson 2 · not triggered this round</span>
              <h2>The goal decides everything</h2>
              <p>Every campaign reached its goal. In all-or-nothing crowdfunding, one coin short would have meant zero.</p>
            </div>
          )}
          {results.lessons.map((l, i) => {
            const c = results.campaigns[l.teamId];
            return (
              <div key={l.key} className="card lesson stack rise" style={{ animationDelay: `${i * 0.4}s` }}>
                <span className="eyebrow">Lesson {i + 1}</span>
                <h2>{l.title}</h2>
                <p>{l.text}</p>
                <div className="lesson-stats">
                  <Stat label="raised / goal" value={`${c.raised} / ${c.goal}`} tone={c.funded ? "good" : "bad"} />
                  <Stat label="from own team" value={`${c.ownSharePct}%`} />
                  <Stat label="backers" value={c.backers} />
                  <Stat label="shares" value={c.shares} />
                  <Stat label="objective" value={OBJECTIVE_LABEL[c.objective]} />
                </div>
              </div>
            );
          })}
        </div>
      </>
    );
  }

  if (view.showInvestors) {
    const top = results.investorLeaderboard.slice(0, 3).map((id) => results.investors[id]);
    const rest = results.investorLeaderboard.slice(3, 10).map((id) => results.investors[id]);
    const avg = results.investorLeaderboard.length
      ? results.investorLeaderboard.reduce((a, id) => a + results.investors[id].ret, 0) / results.investorLeaderboard.length
      : 0;
    return (
      <>
        <Top title="Top investors" game={game} timer={false} />
        <Podium
          items={top.map((i) => ({
            id: i.playerId,
            title: i.name,
            sub: `Team ${i.teamId.slice(1)} · ${i.coinsPlaced} coins placed`,
            value: i.ret.toFixed(1),
            unit: "return",
          }))}
        />
        <div className="reveal-columns">
          <div className="card flat table-wrap">
            <table className="stats-table">
              <thead>
                <tr><th>#</th><th>Investor</th><th>Team</th><th>Return</th><th>Coins placed</th><th>Wasted</th></tr>
              </thead>
              <tbody>
                {rest.map((i) => (
                  <tr key={i.playerId}>
                    <td className="num">{i.rank}</td>
                    <td className="bold">{i.name}</td>
                    <td>Team {i.teamId.slice(1)}</td>
                    <td className="num bold">{i.ret.toFixed(1)}</td>
                    <td className="num">{i.coinsPlaced}</td>
                    <td className="num">{i.coinsWasted}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="stat-strip vertical">
            <Stat label="average return" value={avg.toFixed(1)} tone="coin" />
            <Stat label="investors" value={results.investorLeaderboard.length} />
            <Stat label="campaigns that paid out" value={`${fundedCount} of ${n}`} tone="good" />
            <Stat label="best possible per coin" value={`${Math.max(...all.map((c) => (c.funded ? c.multiplier : 0))).toFixed(1)}×`} />
          </div>
        </div>
      </>
    );
  }

  if (view.showTeamBoard) {
    const top = results.teamLeaderboard.slice(0, 3).map((id) => results.campaigns[id]);
    return (
      <>
        <Top title="Team leaderboard" game={game} timer={false} />
        <Podium
          items={top.map((c) => ({
            id: c.teamId,
            title: c.name,
            sub: `Team ${c.teamNumber} · ${OBJECTIVE_LABEL[c.objective]} · ${c.funded ? "funded" : "not funded"}`,
            value: String(c.score),
            unit: "points",
          }))}
        />
        <div className="card flat table-wrap">
          <table className="stats-table">
            <thead>
              <tr>
                <th>#</th><th>Campaign</th><th>Team</th><th>Objective</th><th>Goal</th><th>Raised</th><th>Result</th>
                <th>Own team</th><th>Backers</th><th>Shares</th><th>Net</th><th>Score</th>
              </tr>
            </thead>
            <tbody>
              {results.teamLeaderboard.map((id, i) => {
                const c = results.campaigns[id];
                return (
                  <tr key={id} className={i < 3 ? "podium-row" : ""}>
                    <td className="num">{i + 1}</td>
                    <td className="bold display">{c.name}</td>
                    <td className="num">{c.teamNumber}</td>
                    <td>{OBJECTIVE_LABEL[c.objective]}</td>
                    <td className="num">{c.goal} <span className="muted small">{GOAL_WORD[c.goalLevel]}</span></td>
                    <td className="num">{c.raised}</td>
                    <td className={c.funded ? "good bold" : "bad bold"}>{c.funded ? "FUNDED" : "NOT FUNDED"}</td>
                    <td className="num">{c.ownSharePct}%</td>
                    <td className="num">{c.backers}</td>
                    <td className="num">{c.shares}</td>
                    <td className="num">{c.net}</td>
                    <td className="num bold score">{c.score}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="muted">Score by objective: Capital = net coins after rewards · Validation = coins from outside the team · Marketing = 2 × backers + 3 × shares. Not funded = 0.</p>
      </>
    );
  }

  return (
    <>
      <Top title={step === 0 ? "The market has closed" : `Results · ${view.campaignsRevealed} of ${n}`} game={game} timer={false} />
      <div className="screen-grid" style={{ "--cols": cols(n) } as React.CSSProperties}>
        {order.map((id, i) => {
          const c = results.campaigns[id];
          const shown = i < view.campaignsRevealed;
          if (!shown) {
            return (
              <div key={id} className="card reveal-card hidden-card">
                <div className="name display" style={{ fontSize: "1.6rem" }}>{c.name}</div>
                <p className="muted num">Team {c.teamNumber} · Goal {c.goal} · {GOAL_WORD[c.goalLevel]}</p>
                <div className="qmark">?</div>
              </div>
            );
          }
          const latest = i === view.campaignsRevealed - 1;
          return (
            <div key={id} className={`card reveal-card${c.funded ? " accent" : " missed"}${latest ? " rise" : ""}`}>
              <div>
                <div className="name display" style={{ fontSize: "1.7rem" }}>{c.name} <span className="muted" style={{ fontSize: "1rem", fontWeight: 500 }}>Team {c.teamNumber}</span></div>
                <Badges badges={c.badges.filter((b) => b !== "New")} />
              </div>
              <ProgressBar progress={c.progress} funded={c.funded} big noStamp />
              <div className="row between">
                <div className="big-num num">
                  {c.raised} <span className="muted" style={{ fontSize: "1.2rem" }}>of {c.goal}</span>
                </div>
                <div className={`verdict ${c.funded ? "good" : "bad"}`}>{c.funded ? "FUNDED" : "NOT FUNDED"}</div>
              </div>
              <div className="objective-line">
                <b>Objective: {OBJECTIVE_LABEL[c.objective]}</b>
                <span className="muted"> · {OBJECTIVE_SHORT[c.objective]}</span>
              </div>
              <div className="mini-stats">
                <Stat label="own team" value={`${c.ownSharePct}%`} tone={c.ownSharePct >= 50 ? "bad" : undefined} />
                <Stat label="external" value={c.external} />
                <Stat label="backers" value={c.backers} />
                <Stat label="shares" value={c.shares} />
                <Stat label="net" value={c.net} tone="coin" />
                <Stat label="score" value={c.score} tone={c.funded ? "good" : "bad"} />
              </div>
              <div className="choices">
                <span>{GOAL_WORD[c.goalLevel]} goal · {c.multiplier.toFixed(1)}×</span>
                <span>{REWARD_WORD[c.rewardsLevel]} rewards</span>
                <span>{NETWORK_WORD[c.network]}</span>
                <span>{PREP_WORD[c.prep]}</span>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

interface PodiumItem {
  id: string;
  title: string;
  sub: string;
  value: string;
  unit: string;
}

/** 2nd · 1st · 3rd, blocks rising in order 3 → 2 → 1. */
function Podium({ items }: { items: PodiumItem[] }) {
  const slots: { item?: PodiumItem; place: number; delay: number }[] = [
    { item: items[1], place: 2, delay: 0.5 },
    { item: items[0], place: 1, delay: 1.0 },
    { item: items[2], place: 3, delay: 0.1 },
  ];
  return (
    <div className="podium">
      {slots.map(({ item, place, delay }) => (
        <div key={place} className={`podium-slot p${place}`}>
          {item ? (
            <div className="podium-label rise" style={{ animationDelay: `${delay + 0.35}s` }}>
              <div className="podium-name display">{item.title}</div>
              <div className="podium-sub muted">{item.sub}</div>
              <div className="podium-value num">{item.value}<span className="podium-unit"> {item.unit}</span></div>
            </div>
          ) : (
            <div className="podium-label muted">—</div>
          )}
          <div className="podium-block" style={{ animationDelay: `${delay}s` }}>
            <span className="podium-place">{place}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
