import { useEffect, useMemo, useRef, useState } from "react";
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
import { useCountUp, useFlip, useRisingEdge } from "../lib/motion";
import { useFeed, type FeedEvent } from "../lib/feed";
import { setSoundEnabled, sfx, useMarketMusic, useSoundEnabled, useSoundPreference } from "../lib/sound";
import { Badges } from "../components/Badge";
import { Countdown } from "../components/Countdown";
import { ProgressBar } from "../components/ProgressBar";
import { QR } from "../components/QR";
import { Confetti } from "../components/Confetti";

export function Screen() {
  const game = useGame();
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", "dark");
    return () => document.documentElement.removeAttribute("data-theme");
  }, []);
  const soundOn = useSoundEnabled();
  const { remembered } = useSoundPreference();
  const marketOpen = !!game && game.phase === "MARKET" && !game.timerExpired;
  useMarketMusic(marketOpen);

  const toggleFs = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.();
  };

  if (!game) {
    return (
      <div className="screen">
        <Backdrop phase="LOBBY" />
        <h1>FUNDED</h1>
        <p className="muted">Connecting…</p>
      </div>
    );
  }

  return (
    <div className={`screen phase-${game.phase.toLowerCase()}`}>
      <Backdrop phase={game.phase} />
      {game.phase === "LOBBY" && <LobbyScreen game={game} />}
      {game.phase === "BUILD" && <BuildScreen game={game} />}
      {game.phase === "MARKET" && <MarketScreen game={game} />}
      {game.phase === "REVEAL" && <RevealScreen game={game} />}
      <div className="screen-controls">
        <button
          className={`btn small${soundOn ? " primary" : remembered ? " sound-hint" : " ghost"}`}
          onClick={() => setSoundEnabled(!soundOn)}
          aria-pressed={soundOn}
          aria-label={soundOn ? "Turn sound off" : "Turn sound on"}
        >
          {soundOn ? "🔊 Sound on" : remembered ? "🔈 Click to enable sound" : "🔇 Sound off"}
        </button>
        <button className="btn small ghost" onClick={toggleFs} aria-label="Toggle fullscreen">⛶</button>
      </div>
    </div>
  );
}

/** Slow drifting glow behind everything. Colour follows the phase. */
function Backdrop({ phase }: { phase: Game["phase"] }) {
  return (
    <div className={`backdrop ${phase.toLowerCase()}`} aria-hidden>
      <div className="blob a" />
      <div className="blob b" />
      <div className="grid-lines" />
    </div>
  );
}

function Top({ title, game, timer = true, kicker }: { title: string; game: Game; timer?: boolean; kicker?: string }) {
  const now = useNow(250);
  const left = game.phaseEndsAt != null ? game.phaseEndsAt - now : Infinity;
  const urgent = timer && left <= 15_000 && left > 0;
  return (
    <div className="top">
      <div>
        <span className="brand">FUNDED{kicker ? ` · ${kicker}` : ""}</span>
        <h1>{title}</h1>
      </div>
      {timer && game.phaseEndsAt != null && (
        <div className={`timer-wrap${urgent ? " urgent" : ""}${game.timerExpired ? " done" : ""}`}>
          <Countdown endsAt={game.phaseEndsAt} expired={game.timerExpired} huge />
        </div>
      )}
    </div>
  );
}

function cols(n: number) {
  return n <= 4 ? 2 : n <= 6 ? 3 : 4;
}

const FEED_ICON: Record<FeedEvent["kind"], string> = {
  coin: "●",
  share: "↗",
  launch: "🚀",
  funded: "★",
  join: "+",
  lock: "✓",
};

function Ticker({ events, label = "Live" }: { events: FeedEvent[]; label?: string }) {
  return (
    <div className="ticker" aria-live="polite">
      <span className="ticker-label"><span className="live-dot" />{label}</span>
      <div className="ticker-items">
        {events.map((e, i) => (
          <span key={e.id} className={`ticker-item ${e.kind}`} style={{ opacity: 1 - i * 0.14 }}>
            <span className="ticker-icon">{FEED_ICON[e.kind]}</span>
            {e.text}
          </span>
        ))}
        {events.length === 0 && <span className="ticker-item muted">Waiting for the first move…</span>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- LOBBY

function LobbyScreen({ game }: { game: Game }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    getJoinUrl().then(setUrl);
  }, []);
  const teamIds = sortTeamIds(Object.keys(game.teams));
  const shortUrl = url.replace(/^https?:\/\//, "");
  const joined = Object.keys(game.players).length;
  const feed = useFeed(game, 5);
  return (
    <>
      <Top title="Join FUNDED" game={game} timer={false} />
      <div className="lobby-qr">
        <div className="qr-wrap">
          <div className="qr-ring" />
          <div className="qr">{url && <QR value={url} size={328} />}</div>
        </div>
        <div className="stack">
          <p className="muted" style={{ fontSize: "1.3rem" }}>Scan the code or go to</p>
          <div className="join-url">{shortUrl}</div>
          <p className="muted" style={{ fontSize: "1.2rem" }}>Enter your name, pick a team. First in a team is the captain.</p>
          <div className="joined-count">
            <span key={joined} className="joined-num num pop">{joined}</span>
            <span className="muted">joined</span>
          </div>
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
                  <span key={p.id} className="name-chip">{p.name}{p.isCaptain ? " ★" : ""}</span>
                ))}
                {members.length === 0 && <span className="muted waiting-dots">Waiting</span>}
              </div>
            </div>
          );
        })}
      </div>
      <Ticker events={feed} label="Joining" />
    </>
  );
}

// ---------------------------------------------------------------- BUILD

function BuildScreen({ game }: { game: Game }) {
  const teamIds = sortTeamIds(Object.keys(game.teams));
  const locked = teamIds.filter((id) => game.teams[id].lockedIn).length;
  const feed = useFeed(game, 5);
  return (
    <>
      <Top title="Round 1 · Build your campaign" game={game} kicker={`${locked} of ${teamIds.length} locked in`} />
      <div className="ready-bar" aria-hidden>
        <div className="ready-fill" style={{ width: `${(100 * locked) / teamIds.length}%` }} />
      </div>
      <div className="screen-grid" style={{ "--cols": cols(teamIds.length) } as React.CSSProperties}>
        {teamIds.map((id) => {
          const t = game.teams[id];
          const cap = t.captainId ? game.players[t.captainId] : undefined;
          const d = t.decisions;
          const made = [d.goal, d.rewards, d.network, d.prep].filter(Boolean).length + (d.pitch.trim() ? 1 : 0);
          return (
            <div key={id} className={`card team-tile stack tight${t.lockedIn ? " locked-tile" : ""}`}>
              <div className="row between">
                <span className="status">Team {id.slice(1)} · {CASE_BY_ID[t.caseId].name}</span>
                {t.lockedIn && <span className="lock-stamp">Locked in ✓</span>}
              </div>
              <p className="muted">Captain: {cap?.name ?? "—"} · {playersOfTeam(game, id).length} members</p>
              {!t.lockedIn && (
                <div className="decide-row">
                  {Array.from({ length: 5 }, (_, i) => (
                    <span key={i} className={`decide-dot${i < made ? " on" : ""}`} />
                  ))}
                  <span className="muted waiting-dots" style={{ marginLeft: 8 }}>Deciding</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <Ticker events={feed} label="Round 1" />
    </>
  );
}

// ---------------------------------------------------------------- MARKET

function MarketScreen({ game }: { game: Game }) {
  const now = useNow(400);
  const results = useMemo(() => computeResults(game, now), [game, now]);
  const cards = useMemo(() => orderedCampaigns(results), [results]);
  const launching = cards.find(
    (c) => c.prep === "audience" && game.teams[c.teamId].launchedAt != null && now - game.teams[c.teamId].launchedAt! < CONFIG.launchBannerMs,
  );
  const totalPlaced = cards.reduce((a, c) => a + c.placed, 0);
  const placedShown = useCountUp(totalPlaced);
  const feed = useFeed(game, 6);
  const seenEvent = useRef(0);
  useEffect(() => {
    // Play a sound for each new funded / share event, newest first in the feed.
    const fresh = feed.filter((e) => e.id > seenEvent.current);
    if (feed.length) seenEvent.current = Math.max(seenEvent.current, ...feed.map((e) => e.id));
    if (fresh.some((e) => e.kind === "funded")) sfx("funded");
    else if (fresh.some((e) => e.kind === "share")) sfx("share", 0.7);
  }, [feed]);
  const gridRef = useFlip<HTMLDivElement>();
  const ranks = useMemo(() => {
    const byProgress = [...cards].sort((a, b) => b.progress - a.progress || b.raised - a.raised);
    return Object.fromEntries(byProgress.map((c, i) => [c.teamId, i + 1]));
  }, [cards]);
  return (
    <>
      <Top title="Round 2 · The market" game={game} kicker={`${results.campaigns[cards[0]?.teamId]?.name ? cards.filter((c) => c.funded).length : 0} funded`} />
      {launching && (
        <div className="launch-banner" key={launching.teamId}>
          <span className="rocket">🚀</span> Just launched: {launching.name}
        </div>
      )}
      {game.timerExpired && <div className="banner closed-banner">Market closed</div>}
      <div ref={gridRef} className="screen-grid" style={{ "--cols": cols(cards.length) } as React.CSSProperties}>
        {cards.map((c) => (
          <ScreenCard key={c.teamId} c={c} now={now} game={game} rank={ranks[c.teamId]} />
        ))}
      </div>
      <div className="market-footer">
        <div className="pool">
          <div className="pool-bar"><div className="pool-fill" style={{ width: `${(100 * totalPlaced) / Math.max(1, results.totalCoins)}%` }} /></div>
          <span className="num">{placedShown} of {results.totalCoins} coins placed</span>
        </div>
        <Ticker events={feed} />
      </div>
    </>
  );
}

function ScreenCard({ c, now, game, rank }: { c: CampaignResult; now: number; game: Game; rank: number }) {
  const t = game.teams[c.teamId];
  const sharedFlash = t.lastSharedAt != null && now - t.lastSharedAt < 1500;
  const untilLaunch = c.launchesAt != null ? Math.max(0, c.launchesAt - now) : 0;
  const raised = useCountUp(c.raised, 500);
  const fundedAt = useRisingEdge(c.funded);
  const celebrating = fundedAt != null && Date.now() - fundedAt < 3000;
  return (
    <div
      data-flip-key={c.teamId}
      className={`card campaign screen-card${c.pinned ? " pinned" : ""}${!c.launched ? " locked" : ""}${sharedFlash ? " flash" : ""}${c.funded ? " is-funded" : ""}`}
    >
      {c.launched && <div key={c.raised} className="glow-flash" aria-hidden />}
      {celebrating && <Confetti />}
      <div className="rank-pill num" aria-label={`Rank ${rank}`}>#{rank}</div>
      <Badges badges={c.badges} sharedBy={c.sharedBy} />
      <div>
        <div className="name">{c.name}</div>
        <p className="pitch muted">{c.pitch}</p>
      </div>
      {c.launched ? (
        <>
          <ProgressBar progress={c.progress} funded={c.funded} big />
          <div className="coins-line">
            <span className="raised num">
              <span key={c.raised} className="pop">{Math.round(raised)}</span> / {c.goal}
            </span>
            <span className="muted num">{c.backers} backers · {c.shares} shares · {c.multiplier.toFixed(1)}×</span>
          </div>
        </>
      ) : (
        <div className="lock-line" style={{ fontSize: "1.3rem" }}>
          <span className="lock-icon">⏳</span> Launches in <span className="num">{formatClock(untilLaunch)}</span>
          <div className="launch-progress"><div style={{ width: `${100 - (100 * untilLaunch) / (game.settings.launchDelaySeconds * 1000)}%` }} /></div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- REVEAL

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
                <span className="eyebrow">Lesson {l.key === "funded-not-validated" ? 1 : 2}</span>
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
            value: i.ret,
            unit: "return",
            decimals: 1,
          }))}
        />
        <div className="reveal-columns">
          <div className="card flat table-wrap">
            <table className="stats-table">
              <thead>
                <tr><th>#</th><th>Investor</th><th>Team</th><th>Return</th><th>Coins placed</th><th>Wasted</th></tr>
              </thead>
              <tbody>
                {rest.map((i, k) => (
                  <tr key={i.playerId} className="rise" style={{ animationDelay: `${1.4 + k * 0.08}s` }}>
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
            <Stat label="best possible per coin" value={`${Math.max(0, ...all.map((c) => (c.funded ? c.multiplier : 0))).toFixed(1)}×`} />
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
            value: c.score,
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
                  <tr key={id} className={`rise${i < 3 ? " podium-row" : ""}`} style={{ animationDelay: `${1.4 + i * 0.08}s` }}>
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
            <div key={id} className={`card reveal-card${c.funded ? " accent" : " missed"}${latest ? " flip-in" : ""}`}>
              {latest && c.funded && <Confetti />}
              <div>
                <div className="name display" style={{ fontSize: "1.7rem" }}>{c.name} <span className="muted" style={{ fontSize: "1rem", fontWeight: 500 }}>Team {c.teamNumber}</span></div>
                <Badges badges={c.badges.filter((b) => b !== "New")} />
              </div>
              <ProgressBar progress={c.progress} funded={c.funded} big noStamp />
              <div className="row between">
                <div className="big-num num">
                  <RevealNumber value={c.raised} animate={latest} /> <span className="muted" style={{ fontSize: "1.2rem" }}>of {c.goal}</span>
                </div>
                <div className={`verdict ${c.funded ? "good" : "bad"}${latest ? " stamp-in" : ""}`}>{c.funded ? "FUNDED" : "NOT FUNDED"}</div>
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

function RevealNumber({ value, animate }: { value: number; animate: boolean }) {
  const shown = useCountUp(animate ? value : value, 900);
  const [start] = useState(animate ? 0 : value);
  const v = animate ? shown : value;
  void start;
  return <>{Math.round(v)}</>;
}

interface PodiumItem {
  id: string;
  title: string;
  sub: string;
  value: number;
  unit: string;
  decimals?: number;
}

/** 2nd · 1st · 3rd, blocks rising in order 3 → 2 → 1, confetti on the winner. */
function Podium({ items }: { items: PodiumItem[] }) {
  const slots: { item?: PodiumItem; place: number; delay: number }[] = [
    { item: items[1], place: 2, delay: 0.5 },
    { item: items[0], place: 1, delay: 1.0 },
    { item: items[2], place: 3, delay: 0.1 },
  ];
  const [celebrate, setCelebrate] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setCelebrate(true), 1500);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="podium">
      {slots.map(({ item, place, delay }) => (
        <div key={place} className={`podium-slot p${place}`}>
          {item ? (
            <div className="podium-label rise" style={{ animationDelay: `${delay + 0.35}s` }}>
              {place === 1 && celebrate && <Confetti big count={40} />}
              <div className="podium-name display">{item.title}</div>
              <div className="podium-sub muted">{item.sub}</div>
              <div className="podium-value num">
                <PodiumValue value={item.value} decimals={item.decimals ?? 0} delay={delay + 0.35} />
                <span className="podium-unit"> {item.unit}</span>
              </div>
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

function PodiumValue({ value, decimals, delay }: { value: number; decimals: number; delay: number }) {
  const [target, setTarget] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setTarget(value), delay * 1000);
    return () => clearTimeout(t);
  }, [value, delay]);
  const shown = useCountUp(target, 900);
  return <>{shown.toFixed(decimals)}</>;
}
