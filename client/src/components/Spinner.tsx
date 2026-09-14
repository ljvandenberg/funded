export function Spinner({ done = false }: { done?: boolean }) {
  if (done) {
    return (
      <div className="checkmark" role="img" aria-label="Done">
        ✓
      </div>
    );
  }
  return <div className="spinner" role="progressbar" aria-label="Waiting" />;
}
