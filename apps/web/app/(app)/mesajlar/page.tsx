import { requireSession } from '@/lib/session';
import { MessagesPage } from './shared';

export const metadata = { title: 'Mesajlar' };

export default async function Page() {
  const s = await requireSession();
  return <MessagesPage s={s} selectedId={null} highlightId={null} />;
}
