export function CoinRow({ total, used }: { total: number; used: number }) {
  return (
    <div className="coins" role="img" aria-label={`${total - used} of ${total} coins left`}>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={`coin${i < used ? " used" : ""}`} />
      ))}
    </div>
  );
}
