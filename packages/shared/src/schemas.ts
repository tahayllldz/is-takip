/**
 * Form/istek doğrulama şemaları (web ve mobil ortak).
 * İstemci tarafı doğrulama kullanıcıya hızlı geri bildirim içindir; veritabanı
 * fonksiyonları aynı kuralları ayrıca uygular.
 */
import { z } from 'zod';
import { APPROVAL_NOTE_MAX, APPROVAL_NOTE_MIN, HOLD_REASON_MAX, HOLD_REASON_MIN, TASK_PRIORITIES, TASK_STATUSES } from './tasks';

const id = () => z.guid({ error: 'Geçersiz kimlik.' });

export const emailSchema = z
  .string({ error: 'E-posta gerekli.' })
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: 'Geçerli bir e-posta adresi girin.' }));

export const passwordSchema = z
  .string({ error: 'Şifre gerekli.' })
  .min(8, { error: 'Şifre en az 8 karakter olmalı.' })
  .max(72, { error: 'Şifre en fazla 72 karakter olabilir.' });

export const fullNameSchema = z
  .string({ error: 'Ad soyad gerekli.' })
  .trim()
  .min(2, { error: 'Ad soyad en az 2 karakter olmalı.' })
  .max(100, { error: 'Ad soyad en fazla 100 karakter olabilir.' });

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, { error: 'Şifre gerekli.' }),
});

export const companyNameSchema = z
  .string({ error: 'Şirket adı gerekli.' })
  .trim()
  .min(2, { error: 'Şirket adı en az 2 karakter olmalı.' })
  .max(120, { error: 'Şirket adı en fazla 120 karakter olabilir.' });

export const signupSchema = z.object({
  fullName: fullNameSchema,
  companyName: companyNameSchema,
  email: emailSchema,
  password: passwordSchema,
});

export const acceptInviteSignupSchema = z.object({
  token: z.string().min(32, { error: 'Davet bağlantısı geçersiz.' }).max(128),
  fullName: fullNameSchema,
  password: passwordSchema,
});

export const inviteSchema = z
  .object({
    companyId: id(),
    email: emailSchema,
    role: z.enum(['admin', 'employee'], { error: 'Rol seçin.' }),
    adminScope: z.enum(['company', 'groups']).default('company'),
    groupIds: z.array(id()).max(50).default([]),
    scopeGroupIds: z.array(id()).max(50).default([]),
  })
  .refine((v) => !(v.role === 'admin' && v.adminScope === 'groups' && v.scopeGroupIds.length === 0), {
    error: 'Kısıtlı yönetici için en az bir grup seçin.',
    path: ['scopeGroupIds'],
  });

export const groupSchema = z.object({
  name: z.string().trim().min(2, { error: 'Grup adı en az 2 karakter olmalı.' }).max(80, { error: 'Grup adı en fazla 80 karakter olabilir.' }),
  description: z.string().trim().max(500, { error: 'Açıklama en fazla 500 karakter olabilir.' }).optional().default(''),
});

const dateKey = z.iso.date({ error: 'Geçerli bir tarih seçin.' });
const timeKey = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, { error: 'Saat SS:DD biçiminde olmalı.' });

export const taskCreateSchema = z
  .object({
    companyId: id(),
    title: z.string().trim().min(1, { error: 'Görev başlığı gerekli.' }).max(200, { error: 'Başlık en fazla 200 karakter olabilir.' }),
    description: z.string().trim().max(5000, { error: 'Açıklama en fazla 5000 karakter olabilir.' }).optional().default(''),
    assigneeId: id(),
    contributorIds: z.array(id()).max(20, { error: 'En fazla 20 katkıda bulunan eklenebilir.' }).default([]),
    dueDate: dateKey.nullish(),
    dueTime: timeKey.nullish(),
    priority: z.enum(TASK_PRIORITIES).default('normal'),
    groupId: id().nullish(),
    clientRequestId: id(),
    sourceMessageId: id().nullish(),
    /** Görev onayı modülü: tamamlanınca onaylayıcının onayı gerekir */
    requiresApproval: z.boolean().default(false),
    approverId: id().nullish(),
  })
  .refine((v) => !(v.dueTime && !v.dueDate), { error: 'Saat seçtiyseniz tarih de seçin.', path: ['dueDate'] })
  .refine((v) => !v.requiresApproval || Boolean(v.approverId), { error: 'Onaylayacak kişiyi seçin.', path: ['approverId'] })
  .refine((v) => !v.requiresApproval || v.approverId !== v.assigneeId, {
    error: 'Görevin sorumlusu kendi görevini onaylayamaz.',
    path: ['approverId'],
  })
  .refine((v) => !v.contributorIds.includes(v.assigneeId), {
    error: 'Ana sorumlu aynı zamanda katkıda bulunan olamaz.',
    path: ['contributorIds'],
  });

/** Giriş tipi: varsayılanı olan alanlar (açıklama, katkıda bulunanlar, öncelik, onay) isteğe bağlı */
export type TaskCreateInput = z.input<typeof taskCreateSchema>;

export const taskUpdateSchema = z.object({
  taskId: id(),
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(5000).optional(),
  assigneeId: id().optional(),
  contributorIds: z.array(id()).max(20).optional(),
  dueDate: dateKey.nullish(),
  dueTime: timeKey.nullish(),
  clearDue: z.boolean().optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
});

export const statusChangeSchema = z
  .object({
    taskId: id(),
    status: z.enum(TASK_STATUSES),
    reason: z.string().trim().max(HOLD_REASON_MAX, { error: `Neden en fazla ${HOLD_REASON_MAX} karakter olabilir.` }).nullish(),
  })
  .refine((v) => v.status !== 'on_hold' || (v.reason?.length ?? 0) >= HOLD_REASON_MIN, {
    error: 'Beklemeye alırken kısa bir neden yazın.',
    path: ['reason'],
  });

export const approvalNoteSchema = z
  .string()
  .trim()
  .min(APPROVAL_NOTE_MIN, { error: 'Neyin düzeltilmesi gerektiğini kısaca yazın.' })
  .max(APPROVAL_NOTE_MAX, { error: `En fazla ${APPROVAL_NOTE_MAX} karakter yazabilirsiniz.` });

export const commentSchema = z.object({
  taskId: id(),
  body: z.string().trim().min(1, { error: 'Yorum boş olamaz.' }).max(4000, { error: 'Yorum en fazla 4000 karakter olabilir.' }),
  mentionIds: z.array(id()).max(20).default([]),
  clientRequestId: id(),
});

/** Zod hatasını { alan: mesaj } biçimine çevirir (formlarda alan altına yazmak için). */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}
