'use client';
/**
 * Ana sayfa düzenleyicisi (kişisel düzen veya şirket/rol varsayılanı).
 * Sıralama: sürükle-bırak (fare) + "Yukarı/Aşağı" düğmeleri ve Alt+↑/↓ (klavye).
 * Düzen yalnızca görünümü değiştirir; erişim veritabanında RLS ile belirlenir.
 */
import { DASHBOARD_MAX_WIDGETS, DASHBOARD_SOURCE_LABELS, layoutToSave, moveItem, moveTo, type DashboardPlatform, type DashboardSource, type Role } from '@istakip/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition, type KeyboardEvent } from 'react';
import { resetDashboardDefaultAction, resetMyDashboardAction, saveDashboardDefaultAction, saveMyDashboardAction } from '@/app/(app)/actions';

export interface WidgetItem {
  id: string;
  title: string;
  description: string;
}

export function DashboardEditor({
  mode,
  platform,
  role,
  source,
  initial,
  hidden,
  available,
}: {
  mode: 'personal' | 'default';
  platform: DashboardPlatform;
  role?: Role;
  source?: DashboardSource;
  initial: WidgetItem[];
  hidden: string[];
  available: WidgetItem[];
}) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [pool, setPool] = useState(available);
  const [toAdd, setToAdd] = useState(available[0]?.id ?? '');
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [announce, setAnnounce] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const listRef = useRef<HTMLOListElement>(null);
  const dirty = items.map((i) => i.id).join() !== initial.map((i) => i.id).join();

  function move(index: number, delta: -1 | 1) {
    const next = moveItem(items, index, delta);
    if (next === items || next[index + delta] === undefined) return;
    setItems(next);
    const moved = items[index]!;
    setAnnounce(`${moved.title} ${index + delta + 1}. sıraya taşındı.`);
    // Taşınan öğede odak kalsın (klavye ile art arda taşıyabilmek için)
    requestAnimationFrame(() => listRef.current?.querySelectorAll<HTMLElement>('[data-item]')[index + delta]?.focus());
  }

  function remove(index: number) {
    const it = items[index]!;
    setItems(items.filter((_, i) => i !== index));
    setPool((p) => [...p, it]);
    if (!toAdd) setToAdd(it.id);
    setAnnounce(`${it.title} kaldırıldı.`);
  }

  function add() {
    const it = pool.find((p) => p.id === toAdd);
    if (!it || items.length >= DASHBOARD_MAX_WIDGETS) return;
    setItems([...items, it]);
    const rest = pool.filter((p) => p.id !== it.id);
    setPool(rest);
    setToAdd(rest[0]?.id ?? '');
    setAnnounce(`${it.title} en sona eklendi.`);
  }

  function onItemKey(e: KeyboardEvent<HTMLLIElement>, index: number) {
    if (!e.altKey) return;
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      move(index, -1);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      move(index, 1);
    }
  }

  function save() {
    const widgets = layoutToSave(items.map((i) => i.id) as never[], hidden as never[]);
    startTransition(async () => {
      const res = mode === 'personal' ? await saveMyDashboardAction(platform, widgets) : await saveDashboardDefaultAction(role!, platform, widgets);
      if (res.error) {
        setMessage({ ok: false, text: res.error });
        return;
      }
      if (mode === 'personal') {
        router.push('/');
        router.refresh();
      } else {
        setMessage({ ok: true, text: res.message ?? 'Kaydedildi.' });
        router.refresh();
      }
    });
  }

  function reset() {
    const q =
      mode === 'personal'
        ? 'Kendi düzeniniz silinip şirket varsayılanına (yoksa standart düzene) dönülsün mü?'
        : 'Bu rolün şirket varsayılanı silinip standart düzene dönülsün mü?';
    if (!window.confirm(q)) return;
    startTransition(async () => {
      const res = mode === 'personal' ? await resetMyDashboardAction(platform) : await resetDashboardDefaultAction(role!, platform);
      if (res.error) {
        setMessage({ ok: false, text: res.error });
        return;
      }
      if (mode === 'personal') {
        router.push('/');
      }
      router.refresh();
      setMessage({ ok: true, text: res.message ?? 'Sıfırlandı.' });
    });
  }

  return (
    <section aria-labelledby={`duzen-${mode}-${platform}-${role ?? ''}`} className="card p-5">
      <h2 id={`duzen-${mode}-${platform}-${role ?? ''}`} className="text-lg font-bold">
        {mode === 'personal' ? 'Ana sayfanızı düzenleyin' : 'Varsayılan düzen'}
      </h2>
      <p className="hint mb-3">
        {mode === 'personal' && source ? `Şu an: ${DASHBOARD_SOURCE_LABELS[source]}. ` : ''}
        Sürükleyip bırakın veya “Yukarı/Aşağı” düğmelerini kullanın (odaklanmış bileşende Alt+↑/↓). Bu ayar yalnızca görünümü değiştirir; kimin neyi
        göreceğini değiştirmez.
        {hidden.length ? ` ${hidden.length} bileşen kapalı modül nedeniyle gizli; düzeninizde korunur.` : ''}
      </p>
      <p aria-live="polite" className="sr-only">
        {announce}
      </p>

      {items.length === 0 ? <p className="mb-3 text-muted">Ana sayfada bileşen yok. Aşağıdan ekleyin.</p> : null}
      <ol ref={listRef} className="mb-4 space-y-2">
        {items.map((it, i) => (
          <li
            key={it.id}
            data-item
            tabIndex={0}
            draggable
            aria-label={`${i + 1}. ${it.title}`}
            onKeyDown={(e) => onItemKey(e, i)}
            onDragStart={(e) => {
              setDragIndex(i);
              e.dataTransfer.effectAllowed = 'move';
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setOverIndex(i);
            }}
            onDragLeave={() => setOverIndex((o) => (o === i ? null : o))}
            onDrop={(e) => {
              e.preventDefault();
              if (dragIndex !== null && dragIndex !== i) {
                setItems(moveTo(items, dragIndex, i));
                setAnnounce(`${items[dragIndex]!.title} ${i + 1}. sıraya taşındı.`);
              }
              setDragIndex(null);
              setOverIndex(null);
            }}
            onDragEnd={() => {
              setDragIndex(null);
              setOverIndex(null);
            }}
            className={`flex flex-wrap items-center gap-3 rounded-xl border bg-surface px-3 py-2 ${
              overIndex === i && dragIndex !== null && dragIndex !== i ? 'border-brand border-2' : 'border-line'
            } ${dragIndex === i ? 'opacity-50' : ''}`}
          >
            <span aria-hidden="true" className="cursor-grab select-none text-xl text-muted" title="Sürükleyin">
              ⠿
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">
                {i + 1}. {it.title}
              </span>
              <span className="block text-sm text-muted">{it.description}</span>
            </span>
            <span className="flex gap-1">
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`${it.title}: yukarı taşı`}>
                ↑
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => move(i, 1)}
                disabled={i === items.length - 1}
                aria-label={`${it.title}: aşağı taşı`}
              >
                ↓
              </button>
              <button type="button" className="btn btn-danger btn-sm" onClick={() => remove(i)} aria-label={`${it.title}: kaldır`}>
                Kaldır
              </button>
            </span>
          </li>
        ))}
      </ol>

      {pool.length ? (
        <div className="mb-4 flex flex-wrap items-end gap-2">
          <div className="min-w-56 flex-1">
            <label htmlFor={`ekle-${mode}-${platform}-${role ?? ''}`} className="label">
              Bileşen ekle
            </label>
            <select id={`ekle-${mode}-${platform}-${role ?? ''}`} className="input" value={toAdd} onChange={(e) => setToAdd(e.target.value)}>
              {pool.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </div>
          <button type="button" className="btn btn-secondary" onClick={add} disabled={!toAdd || items.length >= DASHBOARD_MAX_WIDGETS}>
            + Ekle
          </button>
        </div>
      ) : null}

      {message ? (
        <p role={message.ok ? 'status' : 'alert'} className={`mb-3 font-semibold ${message.ok ? 'text-ok' : 'text-danger'}`}>
          {message.text}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-primary" onClick={save} disabled={pending || (mode === 'default' && !dirty && source === 'role_default')}>
          {pending ? 'Kaydediliyor…' : mode === 'personal' ? 'Düzeni kaydet' : 'Varsayılanı kaydet'}
        </button>
        <button type="button" className="btn btn-secondary" onClick={reset} disabled={pending}>
          {mode === 'personal' ? 'Varsayılana dön' : 'Standart düzene dön'}
        </button>
        {mode === 'personal' ? (
          <Link href="/" className="btn btn-secondary">
            Vazgeç
          </Link>
        ) : null}
      </div>
    </section>
  );
}
