# FUNDED — the crowdfunding classroom game

A 10-minute live game for up to ~33 students on their phones, one presenter on a laptop and a projector. Teams build a rewards-based crowdfunding campaign (Round 1), then everyone invests 5 coins in the campaigns of other teams (Round 2). The reveal shows who reached their goal, who reached their *objective*, and highlights two lessons from the "Enerchi Bites vs Think Board" case.

- `/` — players (phones)
- `/host` — host console (laptop, protected by a PIN)
- `/screen` — big screen (projector, read-only)

## Run locally

Requires Node 20+.

```bash
npm install
npm run dev
```

Then open http://localhost:5173/host (PIN `1234` unless you set `HOST_PIN`), http://localhost:5173/screen and http://localhost:5173 on a phone in the same network (Vite prints the LAN address).

Jump straight to a finished game (REVEAL) to rehearse the debrief:

```bash
npx tsx scripts/make-fixture.ts data/game.json && npm start
```

Solo test with 30 bots:

```bash
npm run demo
```

Run the tests:

```bash
npm test
```

Production build (the server serves the built client from `client/dist`):

```bash
npm run build
HOST_PIN=2468 npm start
```

## Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `HOST_PIN` | `1234` (with a warning) | PIN for `/host`. Set this in production. |
| `PORT` | `3000` | HTTP port. |
| `PUBLIC_URL` | request origin | Join URL shown in the QR code, e.g. `https://funded.example.com`. |
| `DATA_FILE` | `./data/game.json` | Where the game state is persisted for crash recovery. |
| `DEMO_BOTS` | `0` | Add this many bots at startup when the game is in the lobby. |

## Deploy

One Docker image, one env var. Works on Railway, Render or Fly.io.

```bash
docker build -t funded .
docker run -p 3000:3000 -e HOST_PIN=2468 -v funded-data:/app/data funded
```

The platform must provide HTTPS (phone cameras only open QR links over https). Set `PUBLIC_URL` if the app runs behind a proxy with a different public hostname.

## How the game works

All numbers come from `shared/src/config.ts`. Defaults:

- 5 coins per player, 1 share per player. Placed coins are final: a player can add coins to a campaign but never take them back (the server rejects decreases).
- Goals: Low 9% / Medium 15% / High 24% of all coins in play (players × 5, fixed when the market opens, rounded up). Returns 1.0× / 1.5× / 2.0× if funded, +0.5× with Generous rewards.
- Rewards cost 20% (Modest) or 50% (Generous) of what is raised.
- Network: "Ask friends to back" lets own team members put coins in (count toward the goal, no return, no validation). "Ask friends to share" blocks own-team coins but doubles every share to 2 virtual coins.
- Preparation: "Build an audience first" locks the campaign for 40 s, then launches with pre-pledges worth 20% of the goal, a Video badge and 30 s pinned to the top.
- Funding is all-or-nothing. Each team has a hidden objective (capital, validation or marketing) that decides its score.

Every screen computes its numbers with the same pure function, `computeResults()` in `shared/src/compute.ts`, so phones, host and big screen always agree.

## 10-minute run sheet for the presenter

| Time | Host console | Say |
|---|---|---|
| 0:00 | Open `/host`, enter PIN. Set the number of teams (4–8). Press **Open lobby (reset)** if there is an old game. Put `/screen` on the projector, fullscreen. | "Scan the QR code, enter your name, pick a team. First one in is the captain." |
| 1:00 | **Start Round 1** (3:00). Watch "Locked in" per team. Use **+30 s** if needed. | "Captains: four decisions and a pitch line. Everyone else: read your objective and shout advice." |
| 4:00 | **Open the market** (3:00). Teams that never locked in get defaults. | "You have 5 coins and one Share. Back campaigns you believe in. Own campaign coins give you nothing back." |
| 4:40 | Watch for the launch banner of audience-building teams. | "That team spent 40 seconds building an audience. See what it launches with." |
| 7:00 | **Close market & reveal**. Press **Reveal next** to step through: campaigns one by one (full stats per card), the team podium with a stats table for every team, the investor podium with the top 10, then the lessons. **Back** steps backwards, **Show all** jumps to the end. | Comment on each campaign: goal reached? Objective reached? |
| 8:30 | Leave the lessons on screen. | Debrief: "goal reached" says nothing on its own; own-network money validates nothing; the goal decides everything. |
| 10:00 | **Back to lobby** to play again with the same players, or **Open lobby (reset)** for a new class. | |

Tips:
- Sound on the big screen is on by default. Browsers sometimes block audio until the page has been clicked; the button in the bottom-right corner of `/screen` then reads "Click anywhere for sound", and any click or key press on the page unlocks it. The same button mutes. Lobby music plays in the lobby, a decision-making loop during Round 1, and the market loop while Round 2 is open. A cash register rings when a campaign gets funded, a chirp plays on every share, a shot marks each campaign that reached its goal at the reveal and a whomp one that missed, a fanfare greets the team and investor podiums, and a cinematic boom starts two seconds before the market timer ends so its peak lands on 0:00 (it plays at once if the host closes early). Phones and the host console stay silent. Audio files live in `client/public/audio/`.
- The host console can reassign captains, kick players and add 30 bots for a demo.
- Bots spread their five coins over most of the market (first coin after 5–40 s, then one every 12–40 s) and share once between 20 s and 120 s. The tighter 4–12 s pacing from the design spec emptied all bot wallets before audience-building campaigns launched, which hid that mechanic in demos.
- Timers do not auto-advance; the host always presses the next button.
- Phones that reload come back with the same name, team and coins. A server restart resumes from `data/game.json`.
- The hidden objective is only rendered on the phones of the team that owns it. It is not cryptographically hidden; students who read the socket payload could see it, which is fine for a classroom.

## Project layout

```
shared/   types, config, cases, computeResults() + tests
server/   Express + Socket.IO, authoritative state, timers, bots, persistence + tests
client/   Vite + React: /, /host, /screen
```
