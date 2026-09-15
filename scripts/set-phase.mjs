// Usage: node scripts/set-phase.mjs LOBBY|BUILD|MARKET|REVEAL [port] [revealStep]
import { io } from "socket.io-client";
const phase = process.argv[2];
const port = process.argv[3] || "3000";
const s = io(`http://localhost:${port}`, { transports: ["websocket"] });
const emit = (ev, p) => new Promise((r) => s.emit(ev, p, r));
s.on("connect", async () => {
  const a = await emit("host:auth", { pin: process.env.HOST_PIN || "1234" });
  if (!a.ok) { console.log("auth failed"); process.exit(1); }
  console.log(phase, await emit("host:setPhase", { phase }));
  if (process.argv[4] != null) console.log("step", await emit("host:revealStep", { step: Number(process.argv[4]) }));
  process.exit(0);
});
setTimeout(() => process.exit(1), 5000);
