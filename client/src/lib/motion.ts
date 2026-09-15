import { useEffect, useLayoutEffect, useRef, useState } from "react";

export function reducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/**
 * FLIP reordering: children of the returned ref that carry `data-flip-key`
 * glide from their previous position to their new one on every render.
 */
export function useFlip<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const positions = useRef(new Map<string, { left: number; top: number }>());
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const next = new Map<string, { left: number; top: number }>();
    const reduce = reducedMotion();
    for (const child of Array.from(el.children) as HTMLElement[]) {
      const key = child.dataset.flipKey;
      if (!key) continue;
      // offsetLeft/Top are layout positions: they ignore transforms and
      // scrolling, so a running animation never feeds back into the next one.
      const pos = { left: child.offsetLeft, top: child.offsetTop };
      next.set(key, pos);
      const prev = positions.current.get(key);
      if (prev && !reduce) {
        const dx = prev.left - pos.left;
        const dy = prev.top - pos.top;
        if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
          for (const a of child.getAnimations()) a.cancel();
          child.animate(
            [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "translate(0, 0)" }],
            { duration: 550, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
          );
        }
      }
    }
    positions.current = next;
  });
  return ref;
}

/** Tweens a number toward `value` over `ms` so totals tick up instead of jumping. */
export function useCountUp(value: number, ms = 600): number {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  const start = useRef(0);
  useEffect(() => {
    if (reducedMotion() || shown === value) {
      setShown(value);
      return;
    }
    from.current = shown;
    start.current = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const p = Math.min(1, (t - start.current) / ms);
      const eased = 1 - Math.pow(1 - p, 3);
      const v = from.current + (value - from.current) * eased;
      setShown(p < 1 ? Math.round(v * 10) / 10 : value);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, ms]);
  return shown;
}

/** Returns the time (ms) at which `flag` last became true, or null. */
export function useRisingEdge(flag: boolean): number | null {
  const at = useRef<number | null>(null);
  const prev = useRef(flag);
  if (flag && !prev.current) at.current = Date.now();
  prev.current = flag;
  return flag ? at.current : null;
}
