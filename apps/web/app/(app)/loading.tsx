export default function Loading() {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className="space-y-4">
      <span className="sr-only">Yükleniyor…</span>
      <div className="h-8 w-48 rounded-lg bg-line" />
      <div className="h-40 rounded-2xl border border-line bg-surface" />
      <div className="h-40 rounded-2xl border border-line bg-surface" />
    </div>
  );
}
