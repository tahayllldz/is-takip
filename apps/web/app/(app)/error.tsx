'use client';
import { useEffect } from 'react';

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div role="alert" className="card space-y-3 p-6">
      <h1 className="text-xl font-bold">Sayfa yüklenemedi</h1>
      <p className="text-muted">Bağlantı sorunu olabilir. Tekrar deneyin; sorun sürerse yöneticinize bildirin.</p>
      <button type="button" className="btn btn-primary" onClick={reset}>
        Tekrar dene
      </button>
    </div>
  );
}
