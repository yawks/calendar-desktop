import { FileIcon, defaultStyles } from 'react-file-icon';
import { Monitor, Moon, Sun } from 'lucide-react';

import React from 'react';
import { ThemePreference } from '../../shared/store/ThemeStore';

/** Decode HTML entities in a plain-text string (e.g. snippet previews).
 *  Uses a temporary DOM element so all named and numeric entities are handled
 *  without maintaining a manual list. Control characters are collapsed into spaces. */
export function decodeHtmlEntities(text: string): string {
  if (!text) return text;
  const el = document.createElement('textarea');
  let decoded = text;
  // Some providers return double-encoded snippets (`&amp;nbsp;`). Decode a
  // few times, stopping as soon as the value is stable.
  for (let i = 0; i < 3; i++) {
    el.innerHTML = decoded;
    const next = el.value;
    if (next === decoded) break;
    decoded = next;
  }
  return decoded
    .replace(/[\u00A0\u2007\u202F]/g, ' ')
    .replace(/[\u200B-\u200D\u2060\uFEFF\u00AD]/g, '')
    .replace(/[\r\n\t\u2028\u2029\x00-\x1F\x7F]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Preserve useful details from Error objects, Tauri string rejections and
 * structured invoke errors. */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const candidate = error as Record<string, unknown>;
    for (const key of ['message', 'error', 'description']) {
      if (typeof candidate[key] === 'string') return candidate[key];
    }
    try { return JSON.stringify(error); } catch { /* fall through */ }
  }
  return String(error);
}

/** Prepare provider snippets/body text for a compact, plain-text preview. */
export function formatMailPreview(text: string): string {
  let preview = decodeHtmlEntities(text);
  if (/<\/?[a-z][^>]*>/i.test(preview)) {
    const container = document.createElement('div');
    container.innerHTML = preview.replace(/<br\s*\/?>|<\/(?:p|div|li|tr|h[1-6])>/gi, ' ');
    preview = container.textContent ?? '';
  }
  return decodeHtmlEntities(preview).replace(/\uFFFC/g, '').trim();
}

// ── Avatar colors (used as background with white text) ─────────────────────────
const AVATAR_COLORS = [
  '#1a73e8', '#d93025', '#188038', '#e37400',
  '#9334e6', '#00796b', '#c2185b', '#0277bd',
];

// Sender text colors — chosen for WCAG AA contrast (≥ 4.5:1) on their
// respective backgrounds: white in light mode, #1c1e20 in dark mode.
const SENDER_COLORS_LIGHT = [
  '#1558b0', // blue       ~7.0:1 on white
  '#b91c1c', // red        ~5.1:1 on white
  '#166534', // green      ~7.2:1 on white
  '#c2410c', // orange     ~4.6:1 on white
  '#7c3aed', // purple     ~5.2:1 on white
  '#0f766e', // teal       ~5.5:1 on white
  '#be185d', // pink       ~5.0:1 on white
  '#0369a1', // sky        ~5.7:1 on white
];

const SENDER_COLORS_DARK = [
  '#93c5fd', // blue       ~7.5:1 on #1c1e20
  '#fca5a5', // red        ~8.1:1 on #1c1e20
  '#86efac', // green      ~9.3:1 on #1c1e20
  '#fdba74', // orange     ~8.8:1 on #1c1e20
  '#d8b4fe', // purple     ~8.6:1 on #1c1e20
  '#5eead4', // teal       ~10.2:1 on #1c1e20
  '#f9a8d4', // pink       ~8.3:1 on #1c1e20
  '#7dd3fc', // sky        ~8.5:1 on #1c1e20
];

function hashName(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return Math.abs(h);
}

export function avatarColor(name: string): string {
  return AVATAR_COLORS[hashName(name) % AVATAR_COLORS.length];
}

/** Always returns the same color for a given name; picks from a palette
 *  designed for readable text contrast in light or dark mode. */
export function senderColor(name: string, isDark: boolean): string {
  const palette = isDark ? SENDER_COLORS_DARK : SENDER_COLORS_LIGHT;
  return palette[hashName(name) % palette.length];
}

export function initials(name: string): string {
  return name.split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('') || '?';
}

export const isValidEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

export function formatDate(iso: string): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    const diffDays = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
    if (diffDays < 7) return d.toLocaleDateString([], { weekday: 'short' });
    if (d.getFullYear() !== now.getFullYear()) {
      return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
    }
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}

export function formatFullDate(iso: string): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString([], {
      weekday: 'short', year: 'numeric', month: 'short',
      day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
}

/** Compact, user-facing deadline used by snoozed messages. */
export function formatSnoozeDate(
  iso: string,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  const target = new Date(iso);
  if (Number.isNaN(target.getTime())) return iso;

  const now = new Date();
  const diffMs = target.getTime() - now.getTime();
  const diffMin = Math.round(diffMs / 60_000);
  const diffHours = Math.round(diffMs / 3_600_000);
  const time = target.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  if (diffMs > 0 && diffMin < 60) {
    const count = Math.max(1, diffMin);
    return t('mail.snoozeInMinutes', { count, defaultValue: `in ${count} minute(s)` });
  }
  if (diffMs > 0 && diffHours < 6) {
    return t('mail.snoozeInHours', { count: diffHours, defaultValue: `in ${diffHours} hour(s)` });
  }

  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
  const dayAfter = new Date(tomorrow); dayAfter.setDate(dayAfter.getDate() + 1);

  if (target >= today && target < tomorrow) {
    return t('mail.snoozeTodayAt', { time, defaultValue: `today at ${time}` });
  }
  if (target >= tomorrow && target < dayAfter) {
    return t('mail.snoozeTomorrowAt', { time, defaultValue: `tomorrow at ${time}` });
  }

  const date = target.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return t('mail.snoozeDateAt', { date, time, defaultValue: `${date} at ${time}` });
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const ALL_ACCOUNTS_ID = '__all__';

export function ThemeIcon({ pref }: { readonly pref: ThemePreference }) {
  if (pref === 'light') return React.createElement(Sun, { size: 18 });
  if (pref === 'dark') return React.createElement(Moon, { size: 18 });
  return React.createElement(Monitor, { size: 18 });
}
export const THEME_CYCLE: ThemePreference[] = ['system', 'light', 'dark'];

// ── Folder unread count helpers ────────────────────────────────────────────────
// EWS returns real FolderIds (base64) for well-known folders, not the distinguished
// names ('inbox', 'sentitems', …) used as static sidebar keys. Map by display name.
export const DISPLAY_TO_STATIC: Record<string, string> = {
  'inbox': 'inbox',
  'boîte de réception': 'inbox',
  'sent': 'sentitems',
  'sent items': 'sentitems',
  'envoyés': 'sentitems',
  'éléments envoyés': 'sentitems',
  'trash': 'deleteditems',
  'deleted items': 'deleteditems',
  'corbeille': 'deleteditems',
  'supprimés': 'deleteditems',
  'éléments supprimés': 'deleteditems',
  'drafts': 'drafts',
  'brouillons': 'drafts',
  'spam': 'spam',
  'junk': 'spam',
  'junk e-mail': 'spam',
  'indésirables': 'spam',
  'snoozed': 'snoozed',
};

export function buildUnreadCounts(folders: import('./types').MailFolder[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const f of folders) {
    const key = DISPLAY_TO_STATIC[f.display_name.toLowerCase()] ?? f.folder_id;
    counts[key] = f.unread_count;
  }
  return counts;
}

export function FileTypeIcon({ name, size = 20 }: { readonly name: string; readonly size?: number }) {
  const ext = (name.split('.').pop() ?? '').toLowerCase();
  return React.createElement(
    'div',
    { style: { width: size, height: size, flexShrink: 0 } },
    React.createElement(FileIcon, { extension: ext, ...(defaultStyles[ext as keyof typeof defaultStyles] ?? {}) })
  );
}
