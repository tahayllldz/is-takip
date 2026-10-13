export default function Loading() {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className="space-y-3">
      <span className="sr-only">Görevler yükleniyor…</span>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-16 rounded-xl border border-line bg-surface" />
      ))}
    </div>
  );
}
