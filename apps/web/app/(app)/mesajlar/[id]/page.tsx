import { notFound } from 'next/navigation';
import { requireSession } from '@/lib/session';
import { MessagesPage } from '../shared';

export const metadata = { title: 'Mesajlar' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ m?: string }> }) {
  const [{ id }, sp, s] = await Promise.all([params, searchParams, requireSession()]);
  if (!UUID.test(id)) notFound();
  const highlight = sp.m && UUID.test(sp.m) ? sp.m : null;
  return <MessagesPage s={s} selectedId={id.toLowerCase()} highlightId={highlight} />;
}
