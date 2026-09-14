import { useEffect, useMemo, useState } from "react";
import {
  CASE_BY_ID,
  CONFIG,
  computeResults,
  playersOfTeam,
  revealStepCount,
  sortTeamIds,
  totalAlloc,
  type Game,
  type Phase,
} from "@funded/shared";
import { act, emit, getJoinUrl, getStoredHostPin, setHostPin, useConnected, useGame, useNow } from "../lib/socket";
import { pushToast } from "../lib/toast";
import { Countdown } from "../components/Countdown";
import { QR } from "../components/QR";

export function Host() {
  const game = useGame();
  const connected = useConnected();
  const [authed, setAuthed] = useState(false);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    document.documentElement.removeAttribute("data-theme");
  }, []);

  // Auto-auth with a stored PIN.
  useEffect(() => {
    if (!connected || authed) return;
    const stored = getStoredHostPin();
    if (!stored) return;
    emit("host:auth", { pin: stored }).then((ack) => {
      if (ack.ok) {
        setHostPin(stored);
        setAuthed(true);
      } else setHostPin(null);
    });
  }, [connected, authed]);

  const login = async () => {
    setBusy(true);
    const ack = await emit("host:auth", { pin });
    setBusy(false);
    if (ack.ok) {
      setHostPin(pin);
      setAuthed(true);
    } else pushToast(ack.message, "error");
  };

  if (!authed) {
    return (
      <div className="page stack" style={{ paddingTop: 60 }}>
        <span className="brand">FUNDED</span>
        <h1>Host console</h1>
        <label className="field">
          Host PIN
          <input className="input" type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} onKeyDown={(e) => e.key === "Enter" && login()} autoFocus />
        </label>
        <button className="btn primary block" onClick={login} disabled={!pin || busy || !connected}>
          {connected ? "Enter" : "Connecting…"}
        </button>
      </div>
    );
  }

  if (!game) return <div className="page">Loading…</div>;
  return <Console game={game} />;
}

const PHASE_LABEL: Record<Phase, string> = { LOBBY: "Lobby", BUILD: "Round 1 · Build", MARKET: "Round 2 · Market", REVEAL: "Reveal" };

function Console({ game }: { game: Game }) {
  const now = useNow(1000);
  const results = useMemo(() => computeResults(game, now), [game, now]);
  const teamIds = sortTeamIds(Object.keys(game.teams));
  const players = Object.values(game.players);
  const humans = players.filter((p) => !p.isBot);
  const bots = players.length - humans.length;
  const locked = teamIds.filter((id) => game.teams[id].lockedIn).length;
  const coinsPlaced = Object.values(game.pledges).reduce((a, p) => a + totalAlloc(p.alloc), 0);
  const [joinUrl, setJoinUrl] = useState("");
  useEffect(() => {
    getJoinUrl().then(setJoinUrl);
  }, []);

  const setPhase = (phase: Phase, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    act("host:setPhase", { phase });
  };
  const reset = () => {
    if (!window.confirm("Reset the whole game? All players will have to join again.")) return;
    act("host:reset");
  };
  const stepMax = revealStepCount(game);

  return (
    <div className="page wide stack">
      <div className="header row between">
        <div className="row">
          <span className="brand">FUNDED</span>
          <h2>Host console</h2>
          <span className="phase-pill">{PHASE_LABEL[game.phase]}</span>
          {game.timerExpired && game.phase !== "REVEAL" && <span className="chip">Timer ended</span>}
        </div>
        <div className="row">
          {game.phaseEndsAt != null && <Countdown endsAt={game.phaseEndsAt} expired={game.timerExpired} />}
          {game.phaseEndsAt != null && (
            <button className="btn small" onClick={() => act("host:addTime", { seconds: 30 })}>
              +30 s
            </button>
          )}
        </div>
      </div>

      <div className="host-grid">
        {/* ---------- left column ---------- */}
        <div className="stack">
          <div className="card stack">
            <h3>Run the session</h3>
            <div className="phase-steps">
              <button className="btn" onClick={reset}>Open lobby (reset)</button>
              <button className="btn primary" disabled={game.phase !== "LOBBY"} onClick={() => setPhase("BUILD")}>
                Start Round 1
              </button>
              <button
                className="btn primary"
                disabled={game.phase !== "BUILD"}
                onClick={() =>
                  setPhase("MARKET", locked < teamIds.length ? `${teamIds.length - locked} team(s) haven't locked in. Open the market anyway? Missing choices get defaults.` : undefined)
                }
              >
                Open the market
              </button>
              <button className="btn primary" disabled={game.phase !== "MARKET"} onClick={() => setPhase("REVEAL", game.timerExpired ? undefined : "The market timer is still running. Close it and reveal?")}>
                Close market & reveal
              </button>
              <button className="btn" disabled={game.phase === "LOBBY"} onClick={() => setPhase("LOBBY", "Back to the lobby? Players stay, decisions and coins are cleared.")}>
                Back to lobby
              </button>
            </div>
          </div>

          {game.phase === "REVEAL" && (
            <div className="card stack">
              <h3>Reveal</h3>
              <p className="small muted num">Step {game.revealStep} of {stepMax}</p>
              <div className="row">
                <button className="btn primary grow" disabled={game.revealStep >= stepMax} onClick={() => act("host:revealStep", { delta: 1 })}>
                  Reveal next
                </button>
                <button className="btn" disabled={game.revealStep <= 0} onClick={() => act("host:revealStep", { delta: -1 })}>
                  Back
                </button>
                <button className="btn" onClick={() => act("host:revealStep", { step: stepMax })}>Show all</button>
              </div>
              <p className="tiny muted">Steps: one per campaign, then team leaderboard, investor top 5, lessons.</p>
            </div>
          )}

          <div className="card stack">
            <h3>Live status</h3>
            <dl className="kv">
              <dt>Players</dt><dd className="num">{players.length} ({humans.length} humans, {bots} bots) · {players.filter((p) => p.connected).length} online</dd>
              {game.phase === "BUILD" && <><dt>Locked in</dt><dd className="num">{locked} / {teamIds.length}</dd></>}
              {game.phase === "MARKET" && <><dt>Coins placed</dt><dd className="num">{coinsPlaced} / {game.totalCoins ?? 0}</dd></>}
              {game.phase === "MARKET" && <><dt>Shares used</dt><dd className="num">{players.filter((p) => p.sharedTeamId).length} / {players.length}</dd></>}
              <dt>Coins in play</dt><dd className="num">{results.totalCoins}</dd>
            </dl>
          </div>

          <Settings game={game} />

          <div className="card stack">
            <h3>Demo &amp; test</h3>
            <div className="row wrap">
              <button className="btn" disabled={game.phase === "REVEAL"} onClick={() => act("host:addBots", { count: 30 })}>Add 30 bots</button>
              <button className="btn" disabled={game.phase === "REVEAL"} onClick={() => act("host:addBots", { count: 5 })}>Add 5</button>
              <button className="btn danger" disabled={bots === 0} onClick={() => act("host:removeBots")}>Remove bots</button>
            </div>
            <p className="tiny muted">Bots pick random decisions if their captain is a bot, then invest one coin every 4–12 s and share once.</p>
          </div>

          <div className="card stack">
            <h3>Join link</h3>
            {joinUrl && (
              <>
                <div style={{ background: "#fff", padding: 8, borderRadius: 12, alignSelf: "flex-start" }}>
                  <QR value={joinUrl} size={180} />
                </div>
                <a href={joinUrl} target="_blank" rel="noreferrer" className="bold" style={{ wordBreak: "break-all" }}>{joinUrl}</a>
                <div className="row wrap">
                  <a className="btn small" href="/screen" target="_blank" rel="noreferrer">Open big screen</a>
                  <button className="btn small" onClick={() => navigator.clipboard?.writeText(joinUrl).then(() => pushToast("Copied", "success"))}>Copy link</button>
                </div>
              </>
            )}
          </div>
        </div>

        {/* ---------- right column: teams ---------- */}
        <div className="stack">
          <div className="team-grid">
            {teamIds.map((id) => {
              const team = game.teams[id];
              const members = playersOfTeam(game, id);
              const c = results.campaigns[id];
              const noCaptain = !team.captainId;
              return (
                <div key={id} className={`card stack tight${noCaptain && members.length ? " coin" : ""}`}>
                  <div className="row between">
                    <span className="display bold">Team {id.slice(1)} · {CASE_BY_ID[team.caseId].name}</span>
                    {game.phase === "BUILD" && <span className={`chip${team.lockedIn ? " you" : ""}`}>{team.lockedIn ? "Locked in ✓" : "Deciding…"}</span>}
                    {game.phase === "MARKET" && <span className="chip num">{c.launched ? `${c.raised}/${c.goal}` : "locked"}</span>}
                  </div>
                  {members.length === 0 && <p className="muted small">No members yet</p>}
                  {noCaptain && members.length > 0 && <p className="small bold">No captain!</p>}
                  <div className="roster">
                    {members.map((p) => (
                      <div key={p.id} className="member small">
                        <span className={`dot${p.connected ? "" : " off"}`} />
                        <span className="grow">{p.name}{p.late ? <span className="muted"> (late)</span> : null}</span>
                        {p.isCaptain && <span className="chip captain">Captain</span>}
                        <button className="btn small ghost" title="Kick" aria-label={`Kick ${p.name}`} onClick={() => window.confirm(`Kick ${p.name}?`) && act("host:kick", { playerId: p.id })}>
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                  {members.length > 0 && (
                    <label className="field tiny">
                      Captain
                      <select className="input" value={team.captainId ?? ""} onChange={(e) => e.target.value && act("makeCaptain", { playerId: e.target.value })}>
                        <option value="">—</option>
                        {members.map((p) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                    </label>
                  )}
                  {game.phase !== "LOBBY" && (
                    <p className="tiny muted">
                      {c.goalLevel} · {c.rewardsLevel} · {c.network} · {c.prep}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function Settings({ game }: { game: Game }) {
  const s = game.settings;
  const editable = game.phase === "LOBBY";
  const [form, setForm] = useState({
    teamCount: s.teamCount,
    buildSeconds: s.buildSeconds,
    marketSeconds: s.marketSeconds,
    launchDelaySeconds: s.launchDelaySeconds,
    coinsPerPlayer: s.coinsPerPlayer,
  });
  useEffect(() => {
    setForm({ teamCount: s.teamCount, buildSeconds: s.buildSeconds, marketSeconds: s.marketSeconds, launchDelaySeconds: s.launchDelaySeconds, coinsPerPlayer: s.coinsPerPlayer });
  }, [s.teamCount, s.buildSeconds, s.marketSeconds, s.launchDelaySeconds, s.coinsPerPlayer]);

  const field = (key: keyof typeof form, label: string, min: number, max: number) => (
    <label className="field small">
      {label}
      <input
        className="input"
        type="number"
        min={min}
        max={max}
        value={form[key]}
        disabled={!editable}
        onChange={(e) => setForm({ ...form, [key]: Number(e.target.value) })}
      />
    </label>
  );

  return (
    <div className="card stack">
      <h3>Settings {!editable && <span className="tiny muted">(lobby only)</span>}</h3>
      <div className="settings-grid">
        {field("teamCount", `Teams (${CONFIG.minTeams}–${CONFIG.maxTeams})`, CONFIG.minTeams, CONFIG.maxTeams)}
        {field("coinsPerPlayer", "Coins per player", 1, 20)}
        {field("buildSeconds", "Round 1 (s)", 30, 1800)}
        {field("marketSeconds", "Market (s)", 30, 1800)}
        {field("launchDelaySeconds", "Launch delay (s)", 0, 600)}
      </div>
      <button className="btn" disabled={!editable} onClick={() => act("host:setSettings", form).then((a) => a.ok && pushToast("Settings saved", "success"))}>
        Save settings
      </button>
    </div>
  );
}
