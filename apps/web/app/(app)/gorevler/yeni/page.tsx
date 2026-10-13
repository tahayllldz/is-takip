import { randomUUID } from 'node:crypto';
import { TaskForm } from '@/components/tasks/task-form';
import { Alert, Card, PageHeader } from '@/components/ui';
import { moduleOn, requireSession } from '@/lib/session';
import { taskFormOptions } from '@/lib/task-form-data';

export const metadata = { title: 'Yeni görev' };

export default async function NewTaskPage({ searchParams }: { searchParams: Promise<{ grup?: string; kisi?: string }> }) {
  const s = await requireSession();
  if (!moduleOn(s, 'tasks')) return <Alert tone="warning" title="Görevler modülü kapalı">Yeni görev oluşturulamaz.</Alert>;
  if (!s.can('tasks.create')) return <Alert tone="danger" title="Yetkiniz yok">Görev oluşturma yetkiniz bulunmuyor.</Alert>;
  const sp = await searchParams;
  const opts = await taskFormOptions(s);
  return (
    <>
      <PageHeader title="Yeni görev" description="Başlık ve sorumlu yeterli; diğer alanlar isteğe bağlı." />
      <Card>
        <TaskForm
          mode="create"
          me={s.userId}
          clientRequestId={randomUUID()}
          {...opts}
          defaults={{ groupId: sp.grup ?? null, assigneeId: sp.kisi }}
        />
      </Card>
    </>
  );
}
