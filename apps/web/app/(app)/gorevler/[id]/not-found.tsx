import Link from 'next/link';
import { Alert } from '@/components/ui';

export default function TaskNotFound() {
  return (
    <div className="space-y-4">
      <Alert tone="warning" title="Görev bulunamadı">
        Görev silinmiş olabilir ya da bu göreve erişiminiz yok (ör. gruptan çıkarıldıysanız).
      </Alert>
      <Link href="/gorevler" className="btn btn-secondary">
        Görevlere dön
      </Link>
    </div>
  );
}
