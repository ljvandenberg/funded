import { useMemo } from "react";

const COLORS = ["var(--coin)", "var(--accent)", "var(--good)", "#ff6b9d", "#8b7bff", "#ffffff"];

/** A one-shot CSS confetti burst. Mount it when something worth celebrating happens. */
export function Confetti({ count = 28, big = false }: { count?: number; big?: boolean }) {
  const pieces = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => {
        const angle = (i / count) * Math.PI * 2 + Math.random() * 0.5;
        const dist = (big ? 220 : 120) * (0.6 + Math.random() * 0.6);
        return {
          x: Math.cos(angle) * dist,
          y: Math.sin(angle) * dist - (big ? 80 : 40),
          rot: Math.random() * 720 - 360,
          color: COLORS[i % COLORS.length],
          delay: Math.random() * 0.15,
          size: big ? 10 + Math.random() * 8 : 6 + Math.random() * 6,
        };
      }),
    [count, big],
  );
  return (
    <div className="confetti" aria-hidden>
      {pieces.map((p, i) => (
        <span
          key={i}
          style={
            {
              "--x": `${p.x}px`,
              "--y": `${p.y}px`,
              "--r": `${p.rot}deg`,
              background: p.color,
              animationDelay: `${p.delay}s`,
              width: p.size,
              height: p.size * 0.6,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}
