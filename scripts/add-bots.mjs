import { io } from "socket.io-client";
const pin = process.env.HOST_PIN || "1234";
const s = io("http://localhost:3000", { transports: ["websocket"] });
const emit = (ev, p) => new Promise((r) => s.emit(ev, p, r));
s.on("connect", async () => {
  const a = await emit("host:auth", { pin });
  if (!a.ok) { console.log("auth failed:", a.message); process.exit(1); }
  const b = await emit("host:addBots", { count: 30 });
  console.log("addBots:", b);
  s.once("state", (g) => {
    const n = Object.values(g.players).length, bots = Object.values(g.players).filter(p => p.isBot).length;
    console.log(`players: ${n} (${bots} bots), phase ${g.phase}, teams ${Object.keys(g.teams).length}`);
    process.exit(0);
  });
});
setTimeout(() => { console.log("timeout"); process.exit(1); }, 5000);
