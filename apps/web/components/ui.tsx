/**
 * Temel arayüz parçaları (sunucu bileşenlerinde de kullanılabilir).
 * Durumlar yalnızca renkle anlatılmaz: her rozet metin + ayrı bir simge içerir.
 */
import {
  TASK_PRIORITY_META,
  TASK_STATUS_META,
  dueLabel,
  dueState,
  type TaskPriority,
  type TaskStatus,
  type TaskTiming,
  type Tone,
} from '@istakip/shared';
import Link from 'next/link';
import type { ReactNode } from 'react';

const toneClass: Record<Tone, string> = {
  neutral: 'bg-neutral-soft text-ink border-line',
  info: 'bg-info-soft text-info border-[#bcd2f7]',
  warning: 'bg-warn-soft text-warn border-[#f3d39a]',
  success: 'bg-ok-soft text-ok border-[#b6dfc7]',
  danger: 'bg-danger-soft text-danger border-[#f1b8b2]',
};

export function Badge({ tone = 'neutral', symbol, children }: { tone?: Tone; symbol?: string; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[0.9375rem] font-semibold ${toneClass[tone]}`}>
      {symbol ? <span aria-hidden="true">{symbol}</span> : null}
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: TaskStatus }) {
  const m = TASK_STATUS_META[status];
  return (
    <Badge tone={m.tone} symbol={m.symbol}>
      {m.label}
    </Badge>
  );
}

export function PriorityBadge({ priority }: { priority: TaskPriority }) {
  if (priority === 'normal') return null;
  const m = TASK_PRIORITY_META[priority];
  return (
    <Badge tone={m.tone} symbol={m.symbol}>
      {m.label} öncelik
    </Badge>
  );
}

export function DueBadge({ task, tz }: { task: TaskTiming; tz: string }) {
  const state = dueState(task, tz);
  if (state === 'none') return <span className="text-muted">Son tarih yok</span>;
  const label = dueLabel(task, tz);
  if (state === 'overdue') return <Badge tone="danger" symbol="⚠">{label}</Badge>;
  if (state === 'today') return <Badge tone="warning" symbol="◷">{label}</Badge>;
  if (state === 'done_late') return <Badge tone="neutral" symbol="✓">{label}</Badge>;
  return <span className="text-muted">◷ {label}</span>;
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold">{title}</h1>
        {description ? <p className="mt-1 text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function Card({ title, actions, children, className = '' }: { title?: string; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card p-5 ${className}`} aria-label={title}>
      {title || actions ? (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title ? <h2 className="text-lg font-bold">{title}</h2> : <span />}
          {actions}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-line bg-surface px-5 py-8 text-center">
      <p className="font-semibold">{title}</p>
      {children ? <div className="mt-1 text-muted">{children}</div> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function Alert({ tone = 'info', title, children }: { tone?: 'info' | 'danger' | 'success' | 'warning'; title?: string; children: ReactNode }) {
  const cls = {
    info: 'border-[#bcd2f7] bg-info-soft',
    danger: 'border-[#f1b8b2] bg-danger-soft',
    success: 'border-[#b6dfc7] bg-ok-soft',
    warning: 'border-[#f3d39a] bg-warn-soft',
  }[tone];
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={`rounded-xl border px-4 py-3 ${cls}`}>
      {title ? <p className="font-semibold">{title}</p> : null}
      <div>{children}</div>
    </div>
  );
}

export function ButtonLink({ href, children, variant = 'primary' }: { href: string; children: ReactNode; variant?: 'primary' | 'secondary' }) {
  return (
    <Link href={href} className={`btn ${variant === 'primary' ? 'btn-primary' : 'btn-secondary'}`}>
      {children}
    </Link>
  );
}

export function Avatar({ name }: { name: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toLocaleUpperCase('tr-TR'))
    .join('');
  return (
    <span aria-hidden="true" className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-soft text-sm font-bold text-brand">
      {initials || '?'}
    </span>
  );
}
