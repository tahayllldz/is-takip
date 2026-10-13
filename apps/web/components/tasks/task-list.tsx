import type { Task } from '@istakip/shared';
import Link from 'next/link';
import { ApprovalBadge, DueBadge, PriorityBadge, StatusBadge } from '../ui';

/** Görev listesi: her satır başlık, durum (metin+simge), sorumlu, son tarih ve grubu gösterir. */
export function TaskList({
  tasks,
  tz,
  nameOf,
  groupName,
  showAssignee = true,
  showCreator = false,
  approvalOn = false,
}: {
  tasks: Task[];
  tz: string;
  nameOf: (id: string) => string;
  groupName?: (id: string | null) => string | null;
  showAssignee?: boolean;
  showCreator?: boolean;
  /** Görev onayı modülü açıksa onay durumu da gösterilir (kapalı modülün öğesi görünmez) */
  approvalOn?: boolean;
}) {
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
      {tasks.map((t) => {
        const g = groupName?.(t.group_id);
        return (
          <li key={t.id}>
            <Link href={`/gorevler/${t.id}`} className="flex flex-col gap-2 px-4 py-3 hover:bg-canvas sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="truncate font-semibold">{t.title}</p>
                <p className="text-[0.9375rem] text-muted">
                  {showAssignee ? <>Sorumlu: {nameOf(t.assignee_id)}</> : null}
                  {showAssignee && showCreator ? ' · ' : null}
                  {showCreator ? <>Veren: {nameOf(t.created_by)}</> : null}
                  {g ? <> · {g}</> : null}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                <PriorityBadge priority={t.priority} />
                <DueBadge task={t} tz={tz} />
                <StatusBadge status={t.status} />
                {approvalOn && t.approval_status ? <ApprovalBadge status={t.approval_status} /> : null}
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
