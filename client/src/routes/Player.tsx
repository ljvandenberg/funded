import { useEffect, useMemo, useRef, useState } from "react";
import {
  CASE_BY_ID,
  CONFIG,
  OBJECTIVE_LABEL,
  computeResults,
  estimateTotalCoins,
  goalCoins,
  inputsOpen,
  orderedCampaigns,
  playersOfTeam,
  revealView,
  sortTeamIds,
  totalAlloc,
  type CampaignResult,
  type DecisionField,
  type Game,
  type Player as PlayerT,
  type Team,
} from "@funded/shared";
import { act, emit, getPlayerId, getSavedName, setPlayerId, setSavedName, useConnected, useGame, useNow } from "../lib/socket";
import { pushToast } from "../lib/toast";
import { Countdown } from "../components/Countdown";
import { Spinner } from "../components/Spinner";
import { CampaignCard, type ShareState } from "../components/CampaignCard";
import { CoinRow } from "../components/Coins";
import { Leaderboard } from "../components/Leaderboard";

export function Player() {
  const game = useGame();
  const connected = useConnected();
  const [playerId, setPid] = useState<string | null>(getPlayerId());

  // Try to resume a stored session once the first state arrives.
  const triedResume = useRef(false);
  useEffect(() => {
    if (!game || triedResume.current) return;
    triedResume.current = true;
    const pid = getPlayerId();
    if (!pid) return;
    emit("resume", { playerId: pid }).then((ack) => {
      if (!ack.ok) {
        // Game was reset or we were kicked; forget the id but keep the name.
        setPlayerId(null);
        setPid(null);
      }
    });
  }, [game]);

  // If our player disappears from the state for more than a moment (kicked,
  // reset), drop the id so the join screen appears. A short grace period
  // covers the gap between a join ack and the next state broadcast.
  const missing = !!(game && playerId && !game.players[playerId]);
  useEffect(() => {
    if (!missing) return;
    const t = setTimeout(() => {
      setPlayerId(null);
      setPid(null);
    }, 2000);
    return () => clearTimeout(t);
  }, [missing]);

  useEffect(() => {
    document.documentElement.removeAttribute("data-theme");
  }, []);

  if (!game) {
    return (
      <div className="page center stack" style={{ paddingTop: 80 }}>
        <Spinner />
        <p className="muted">{connected ? "Loading the game…" : "Connecting…"}</p>
      </div>
    );
  }

  const me = playerId ? game.players[playerId] : undefined;
  if (!me) {
    if (playerId) {
      return (
        <div className="page center stack" style={{ paddingTop: 80 }}>
          <Spinner />
          <p className="muted">Joining…</p>
        </div>
      );
    }
    return (
      <Join
        game={game}
        onJoined={(id) => {
          setPlayerId(id);
          setPid(id);
        }}
      />
    );
  }

  const team = game.teams[me.teamId];
  if (!team) {
    return <Join game={game} onJoined={(id) => { setPlayerId(id); setPid(id); }} />;
  }

  switch (game.phase) {
    case "LOBBY":
      return <LobbyWait game={game} me={me} team={team} />;
    case "BUILD":
      return me.isCaptain ? <CaptainBuild game={game} me={me} team={team} /> : <MemberBuild game={game} me={me} team={team} />;
    case "MARKET":
      return <Market game={game} me={me} />;
    case "REVEAL":
      return <Reveal game={game} me={me} />;
  }
}

// ---------------------------------------------------------------- JOIN

function Join({ game, onJoined }: { game: Game; onJoined: (id: string) => void }) {
  const [name, setName] = useState(getSavedName());
  const [teamId, setTeamId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const teamIds = sortTeamIds(Object.keys(game.teams));
  const over = game.phase === "REVEAL";

  const submit = async () => {
    if (!name.trim() || !teamId || busy) return;
    setBusy(true);
    const ack = await emit("join", { name: name.trim(), teamId });
    setBusy(false);
    if (ack.ok && ack.playerId) {
      setSavedName(name.trim());
      onJoined(ack.playerId);
    } else if (!ack.ok) pushToast(ack.message, "error");
  };

  return (
    <div className="page stack">
      <div className="stack tight" style={{ paddingTop: 24 }}>
        <span className="brand">FUNDED</span>
        <h1>Join FUNDED</h1>
        <p className="muted">Crowdfunding, played live. Pick a team and get ready to build and invest.</p>
      </div>
      {over ? (
        <div className="card">The game is over. Wait for the host to open the lobby again.</div>
      ) : (
        <>
          <label className="field">
            Your name
            <input
              className="input"
              value={name}
              maxLength={CONFIG.nameMaxLength}
              placeholder="e.g. Lisa"
              autoComplete="given-name"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
          </label>
          <div className="stack tight">
            <span className="bold small">Pick a team</span>
            <div className="teams">
              {teamIds.map((id) => {
                const members = playersOfTeam(game, id);
                const cap = game.teams[id].captainId ? game.players[game.teams[id].captainId!] : undefined;
                return (
                  <button key={id} className="team-btn" aria-pressed={teamId === id} aria-label={`Team ${id.slice(1)}`} onClick={() => setTeamId(id)}>
                    <span className="t">Team {id.slice(1)}</span>
                    <span className="tiny muted">
                      {members.length === 0
                        ? "You'll be the captain"
                        : `${members.length} joined · Captain: ${cap?.name ?? "—"}`}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
          <button className="btn primary block" onClick={submit} disabled={!name.trim() || !teamId || busy}>
            Join
          </button>
          {game.phase !== "LOBBY" && (
            <p className="muted small center">The game has already started. You can still join.</p>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- ROSTER

function Roster({ game, me, team, canPromote }: { game: Game; me: PlayerT; team: Team; canPromote: boolean }) {
  const members = playersOfTeam(game, team.id);
  return (
    <div className="roster">
      {members.map((p) => (
        <div key={p.id} className="member">
          <span className={`dot${p.connected ? "" : " off"}`} />
          <span className="grow">{p.name}</span>
          {p.id === me.id && <span className="chip you">You</span>}
          {p.isCaptain && <span className="chip captain">Captain</span>}
          {canPromote && !p.isCaptain && (
            <button className="btn small ghost" onClick={() => act("makeCaptain", { playerId: p.id })}>
              Make captain
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function Header({ title, game }: { title: string; game: Game }) {
  return (
    <div className="header row between">
      <div>
        <span className="brand">FUNDED</span>
        <h2>{title}</h2>
      </div>
      {game.phaseEndsAt != null && <Countdown endsAt={game.phaseEndsAt} expired={game.timerExpired} />}
    </div>
  );
}

// ---------------------------------------------------------------- LOBBY

function LobbyWait({ game, me, team }: { game: Game; me: PlayerT; team: Team }) {
  const leave = async () => {
    const ack = await act("leaveTeam");
    if (ack.ok) {
      setPlayerId(null);
      window.location.reload();
    }
  };
  return (
    <div className="page stack">
      <Header title={`Team ${team.id.slice(1)}`} game={game} />
      <div className="card stack">
        <Spinner />
        <p className="center bold">Waiting for the host to start Round 1…</p>
        {me.isCaptain && <p className="center muted small">You are the captain. You'll make the decisions in Round 1.</p>}
      </div>
      <div className="card stack">
        <h3>Your team</h3>
        <Roster game={game} me={me} team={team} canPromote={me.isCaptain} />
      </div>
      <button className="btn ghost block" onClick={leave}>
        Leave team
      </button>
    </div>
  );
}

// ---------------------------------------------------------------- BUILD (captain)

interface OptionDef {
  value: string;
  title: string;
  effect: string;
}

function decisionOptions(game: Game): Record<DecisionField, OptionDef[]> {
  const s = game.settings;
  const total = estimateTotalCoins(game);
  const players = Object.keys(game.players).length;
  const g = (lvl: "low" | "medium" | "high") => `about ${goalCoins(lvl, total, s)} coins with ${players} players`;
  return {
    goal: [
      { value: "low", title: "Low", effect: `${g("low")} · backers get ${s.multipliers.low.toFixed(1)}× if funded` },
      { value: "medium", title: "Medium", effect: `${g("medium")} · backers get ${s.multipliers.medium.toFixed(1)}× if funded` },
      { value: "high", title: "High", effect: `${g("high")} · backers get ${s.multipliers.high.toFixed(1)}× if funded` },
    ],
    rewards: [
      { value: "modest", title: "Modest rewards", effect: `Reward costs eat ${Math.round(s.rewardCost.modest * 100)}% of what you raise.` },
      {
        value: "generous",
        title: "Generous rewards",
        effect: `Costs ${Math.round(s.rewardCost.generous * 100)}% of what you raise. Card gets a "Top rewards" badge and backers earn +${s.multipliers.generousBonus}× extra.`,
      },
    ],
    network: [
      {
        value: "back",
        title: "Ask friends to back",
        effect: "Your own team may put coins in. Those count toward the goal but give no return and no validation. Shares are worth 1 coin.",
      },
      {
        value: "share",
        title: "Ask friends to share",
        effect: 'Your own team cannot invest in you. Every share you win is worth 2 coins instead of 1, and your card gets a "Spread the word" badge.',
      },
    ],
    prep: [
      { value: "now", title: "Launch now", effect: "Investable from the second the market opens." },
      {
        value: "audience",
        title: "Build an audience first",
        effect: `Locked for the first ${s.launchDelaySeconds} s. Then you launch with pre-pledges worth ${Math.round(s.prePledgeFraction * 100)}% of your goal, a Video badge, and your card pinned to the top for ${s.pinSeconds} s.`,
      },
    ],
  };
}

const DECISION_TITLES: Record<DecisionField, string> = {
  goal: "1 · Funding goal",
  rewards: "2 · Rewards",
  network: "3 · Your network",
  prep: "4 · Preparation",
};

function DecisionGroup({
  field,
  options,
  value,
  onSelect,
  disabled,
}: {
  field: DecisionField;
  options: OptionDef[];
  value: string | null;
  onSelect?: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="stack tight">
      <h3>{DECISION_TITLES[field]}</h3>
      <div className={`options${onSelect ? "" : " preview"}`}>
        {options.map((o) => (
          <button
            key={o.value}
            className="option"
            aria-pressed={value === o.value}
            onClick={() => onSelect?.(o.value)}
            disabled={disabled}
            tabIndex={onSelect ? 0 : -1}
          >
            <span className="title">{o.title}</span>
            <span className="check">{value === o.value ? "✓" : ""}</span>
            <span className="effect">{o.effect}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function CaseCard({ team, showObjective }: { team: Team; showObjective: boolean }) {
  const c = CASE_BY_ID[team.caseId];
  return (
    <div className="card stack tight">
      <span className="tiny muted bold">YOUR CAMPAIGN</span>
      <div className="display" style={{ fontSize: "1.6rem", fontWeight: 800 }}>{c.name}</div>
      <p>{c.blurb}</p>
      {showObjective && (
        <div className="card flat coin stack tight" style={{ marginTop: 6 }}>
          <span className="tiny bold">Your objective (only your team sees this)</span>
          <p className="small">{c.objectiveText}</p>
        </div>
      )}
    </div>
  );
}

function CaptainBuild({ game, me, team }: { game: Game; me: PlayerT; team: Team }) {
  const open = inputsOpen(game, "BUILD");
  const options = useMemo(() => decisionOptions(game), [game]);
  const d = team.decisions;
  const [pitch, setPitch] = useState(d.pitch);
  const pitchTimer = useRef<number | null>(null);
  const localEdit = useRef(false);

  useEffect(() => {
    if (!localEdit.current) setPitch(d.pitch);
  }, [d.pitch]);

  const onPitch = (v: string) => {
    const val = v.slice(0, CONFIG.pitchMaxLength);
    setPitch(val);
    localEdit.current = true;
    if (pitchTimer.current) window.clearTimeout(pitchTimer.current);
    pitchTimer.current = window.setTimeout(() => {
      act("setPitch", { pitch: val }).then(() => (localEdit.current = false));
    }, 300);
  };

  const complete = !!(d.goal && d.rewards && d.network && d.prep && pitch.trim());
  const editable = open && !team.lockedIn;

  return (
    <div className="page stack">
      <Header title="Round 1 · Build your campaign" game={game} />
      {!open && <div className="banner">Round 1 is over. The market opens soon.</div>}
      <CaseCard team={team} showObjective />
      {(["goal", "rewards", "network", "prep"] as DecisionField[]).map((f) => (
        <div className="card" key={f}>
          <DecisionGroup
            field={f}
            options={options[f]}
            value={d[f]}
            onSelect={(v) => act("setDecision", { field: f, value: v })}
            disabled={!editable}
          />
        </div>
      ))}
      <div className="card stack tight">
        <label className="field">
          Pitch line
          <textarea
            className="input"
            value={pitch}
            maxLength={CONFIG.pitchMaxLength}
            placeholder="One sentence that makes strangers want to back you"
            disabled={!editable}
            onChange={(e) => onPitch(e.target.value)}
          />
        </label>
        <span className="tiny muted num" style={{ alignSelf: "flex-end" }}>
          {pitch.length} / {CONFIG.pitchMaxLength}
        </span>
      </div>
      {team.lockedIn ? (
        <div className="row">
          <div className="btn block shared grow" aria-live="polite">Locked in ✓</div>
          <button className="btn" onClick={() => act("lockIn", { locked: false })} disabled={!open}>
            Edit
          </button>
        </div>
      ) : (
        <button className="btn primary block" disabled={!complete || !open} onClick={() => act("lockIn", { locked: true })}>
          Lock in campaign
        </button>
      )}
      <div className="card stack">
        <h3>Your team</h3>
        <Roster game={game} me={me} team={team} canPromote={open} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- BUILD (member)

function MemberBuild({ game, me, team }: { game: Game; me: PlayerT; team: Team }) {
  const captain = team.captainId ? game.players[team.captainId] : undefined;
  const options = useMemo(() => decisionOptions(game), [game]);
  const d = team.decisions;
  return (
    <div className="page stack">
      <Header title="Round 1 · Build your campaign" game={game} />
      <div className="card stack">
        <Spinner done={team.lockedIn} />
        <p className="center bold">
          {team.lockedIn ? "Campaign locked in. The market opens soon." : `Waiting on ${captain?.name ?? "your captain"} to decide…`}
        </p>
        {!team.lockedIn && <p className="center muted small">Shout your suggestions. The choices appear here live.</p>}
      </div>
      <CaseCard team={team} showObjective />
      {(["goal", "rewards", "network", "prep"] as DecisionField[]).map((f) => (
        <div className="card" key={f}>
          <DecisionGroup field={f} options={options[f]} value={d[f]} />
          {!d[f] && <p className="muted small" style={{ marginTop: 8 }}>—</p>}
        </div>
      ))}
      <div className="card stack tight">
        <span className="bold small">Pitch line</span>
        <p className={d.pitch ? "" : "muted"}>{d.pitch || "—"}</p>
      </div>
      <div className="card stack">
        <h3>Your team</h3>
        <Roster game={game} me={me} team={team} canPromote={false} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- MARKET

function Market({ game, me }: { game: Game; me: PlayerT }) {
  const now = useNow(500);
  const open = inputsOpen(game, "MARKET");
  const results = useMemo(() => computeResults(game, now), [game, now]);
  const cards = useMemo(() => orderedCampaigns(results), [results]);
  const budget = game.settings.coinsPerPlayer;

  const serverAlloc = game.pledges[me.id]?.alloc ?? {};
  const serverAllocJson = JSON.stringify(serverAlloc);
  const [alloc, setAlloc] = useState<Record<string, number>>(serverAlloc);
  const pending = useRef(0);
  useEffect(() => {
    if (pending.current === 0) setAlloc(JSON.parse(serverAllocJson));
  }, [serverAllocJson]);

  const used = totalAlloc(alloc);

  const change = (teamId: string, delta: number) => {
    const next = { ...alloc };
    const v = Math.max(0, (next[teamId] || 0) + delta);
    if (v === 0) delete next[teamId];
    else next[teamId] = v;
    if (totalAlloc(next) > budget) {
      pushToast("You have no coins left", "error");
      return;
    }
    setAlloc(next);
    pending.current++;
    emit("setPledge", { alloc: next }).then((ack) => {
      pending.current--;
      if (!ack.ok) {
        pushToast(ack.message, "error");
        setAlloc(JSON.parse(serverAllocJson));
      }
    });
  };

  const sharedName = me.sharedTeamId ? results.campaigns[me.sharedTeamId]?.name : undefined;
  const shareStateFor = (c: CampaignResult): ShareState => {
    if (c.teamId === me.teamId) return "own";
    if (me.sharedTeamId === c.teamId) return "shared-this";
    if (me.sharedTeamId) return "used";
    if (!c.launched) return "locked";
    return "available";
  };

  return (
    <div className="page stack">
      <div className="header stack tight">
        <div className="row between">
          <div>
            <span className="brand">FUNDED</span>
            <h2>Round 2 · Invest</h2>
          </div>
          <Countdown endsAt={game.phaseEndsAt} expired={game.timerExpired} />
        </div>
        <div className="row between">
          <div className="row">
            <CoinRow total={budget} used={used} />
            <span className="small num">{budget - used} coins left</span>
          </div>
          <span className="tiny muted">{me.sharedTeamId ? "Share used" : "1 share left"}</span>
        </div>
      </div>
      {!open && <div className="banner">Market closed. Waiting for results…</div>}
      {cards.map((c) => (
        <CampaignCard
          key={c.teamId}
          c={c}
          now={now}
          isOwn={c.teamId === me.teamId}
          myCoins={alloc[c.teamId] || 0}
          canAdd={true /* over-budget taps show the "no coins left" toast */}
          canRemove={(alloc[c.teamId] || 0) > 0}
          onAdd={() => change(c.teamId, +1)}
          onRemove={() => change(c.teamId, -1)}
          shareState={shareStateFor(c)}
          sharedName={sharedName}
          onShare={() => act("share", { teamId: c.teamId })}
          inputsOpen={open}
        />
      ))}
      <p className="muted tiny center">
        {results.totalCoins} coins in play · goals: {results.campaignOrder
          .map((id) => results.campaigns[id])
          .filter((c, i, a) => a.findIndex((x) => x.goalLevel === c.goalLevel) === i)
          .map((c) => `${c.goalLevel} ${c.goal}`)
          .join(" · ")}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------- REVEAL

function Reveal({ game, me }: { game: Game; me: PlayerT }) {
  const results = useMemo(() => computeResults(game, Date.now()), [game]);
  const view = revealView(game);
  const order = results.campaignOrder;
  const myIdx = order.indexOf(me.teamId);
  const mine = results.campaigns[me.teamId];
  const myRevealed = myIdx >= 0 && view.campaignsRevealed > myIdx;
  const inv = results.investors[me.id];

  return (
    <div className="page stack">
      <div className="header">
        <span className="brand">FUNDED</span>
        <h2>Results</h2>
      </div>
      {view.campaignsRevealed === 0 && (
        <div className="card stack">
          <Spinner />
          <p className="center bold">Market closed. Watch the big screen…</p>
        </div>
      )}
      {myRevealed && mine && (
        <div className={`card stack ${mine.funded ? "accent" : ""}`}>
          <span className="tiny bold muted">YOUR TEAM · {mine.name}</span>
          <div className="display" style={{ fontSize: "2rem", fontWeight: 800, color: mine.funded ? "var(--good)" : "var(--bad)" }}>
            {mine.funded ? "FUNDED" : "NOT FUNDED"}
          </div>
          <dl className="kv">
            <dt>Raised</dt><dd className="num">Raised {mine.raised} of {mine.goal}</dd>
            <dt>Objective</dt><dd>Objective: {OBJECTIVE_LABEL[mine.objective]}</dd>
            <dt>Net</dt><dd className="num">Net after rewards: {mine.net}</dd>
            <dt>Own team</dt><dd className="num">{mine.ownSharePct}% came from your own team</dd>
            <dt>External</dt><dd className="num">{mine.external} coins from outside · {mine.backers} backers · {mine.shares} shares</dd>
            <dt>Score</dt><dd className="num">{mine.score}{view.showTeamBoard ? ` · Rank ${results.teamRank[me.teamId]} of ${order.length}` : ""}</dd>
          </dl>
        </div>
      )}
      {view.campaignsRevealed > 0 && (
        <div className="card stack tight">
          <h3>Campaigns</h3>
          {order.slice(0, view.campaignsRevealed).map((id) => {
            const c = results.campaigns[id];
            return (
              <div key={id} className="row between" style={{ padding: "6px 0", borderBottom: "1px solid var(--line)" }}>
                <span>
                  <span className="bold">{c.name}</span>
                  <span className="muted small"> · {OBJECTIVE_LABEL[c.objective]}</span>
                </span>
                <span className={`num bold small`} style={{ color: c.funded ? "var(--good)" : "var(--bad)" }}>
                  {c.raised}/{c.goal} {c.funded ? "✓" : "✗"}
                </span>
              </div>
            );
          })}
        </div>
      )}
      {view.showTeamBoard && (
        <div className="card stack tight">
          <h3>Teams</h3>
          <Leaderboard
            rows={results.teamLeaderboard.map((id) => {
              const c = results.campaigns[id];
              return { id, label: c.name, sub: `${OBJECTIVE_LABEL[c.objective]} · ${c.funded ? "funded" : "not funded"}`, value: String(c.score), me: id === me.teamId };
            })}
          />
        </div>
      )}
      {view.showInvestors && inv && (
        <>
          <div className="card stack tight">
            <h3>You as investor</h3>
            <div className="display" style={{ fontSize: "1.6rem", fontWeight: 800 }}>
              Your return: {inv.ret} <span className="muted small">· Rank {inv.rank} of {results.investorLeaderboard.length}</span>
            </div>
            {inv.breakdown.length === 0 && <p className="muted small">You didn't place any coins.</p>}
            {inv.breakdown.map((b) => (
              <div key={b.teamId} className="row between small" style={{ padding: "4px 0", borderBottom: "1px solid var(--line)" }}>
                <span>
                  {b.campaignName} {b.own && <span className="muted">(own)</span>}
                </span>
                <span className="num">
                  {b.coins} × {b.multiplier.toFixed(1)} = <b>{b.ret}</b> {b.funded ? "" : "· not funded"}
                </span>
              </div>
            ))}
          </div>
          <div className="card stack tight">
            <h3>Top investors</h3>
            <Leaderboard
              rows={results.investorLeaderboard.slice(0, 10).map((id) => {
                const i = results.investors[id];
                return { id, label: i.name, sub: `Team ${i.teamId.slice(1)}`, value: String(i.ret), me: id === me.id };
              })}
            />
          </div>
        </>
      )}
      {view.showLessons &&
        results.lessons.map((l) => (
          <div key={l.key} className="card lesson stack tight">
            <span className="tiny bold muted">LESSON</span>
            <h2 style={{ fontSize: "1.3rem" }}>{l.title}</h2>
            <p>{l.text}</p>
          </div>
        ))}
    </div>
  );
}
