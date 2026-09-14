import type { Badge as BadgeName } from "@funded/shared";

const CLASS: Record<BadgeName, string> = {
  Video: "video",
  "Top rewards": "rewards",
  "Spread the word": "spread",
  New: "new",
};

export function Badge({ name }: { name: BadgeName }) {
  return <span className={`badge ${CLASS[name]}`}>{name}</span>;
}

export function SharedBy({ names }: { names: string[] }) {
  if (!names.length) return null;
  const shown = names.slice(0, 3).join(", ");
  const extra = names.length > 3 ? ` +${names.length - 3}` : "";
  return <span className="badge shared">Shared by {shown}{extra}</span>;
}

export function Badges({ badges, sharedBy, own = false }: { badges: BadgeName[]; sharedBy?: string[]; own?: boolean }) {
  return (
    <div className="badges">
      {own && <span className="badge own">Your campaign</span>}
      {badges.map((b) => (
        <Badge key={b} name={b} />
      ))}
      {sharedBy && <SharedBy names={sharedBy} />}
    </div>
  );
}
