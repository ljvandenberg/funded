import { useSyncExternalStore } from "react";

export interface Toast {
  id: number;
  text: string;
  kind: "info" | "error" | "success";
}

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function notify() {
  for (const l of listeners) l();
}

export function pushToast(text: string, kind: Toast["kind"] = "info") {
  const id = nextId++;
  toasts = [...toasts, { id, text, kind }].slice(-3);
  notify();
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    notify();
  }, 2800);
}

export function useToasts(): Toast[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => toasts,
  );
}
