import {
  Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts';
import { ArrowLeft, ArrowRight, MessageSquare, Send, Users, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { ContactAvatar } from './ContactAvatar';
import type { MailProvider } from '../providers/MailProvider';
import type { MailThread } from '../types';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

// ── Types ──────────────────────────────────────────────────────────────────────

type PeriodPreset = 'today' | 'yesterday' | 'thisweek' | 'lastweek' | 'thismonth' | 'lastmonth' | 'custom';

interface DateRange { from: Date; to: Date; }

interface MailAccount {
  id: string;
  email: string;
  name?: string;
  providerType: 'ews' | 'gmail' | 'imap' | 'jmap';
  color?: string;
}

interface AccountRef {
  id: string;
  email: string;
  providerType: string;
  color?: string;
}

interface ContactStat {
  key: string;           // lowercase email, or "name:<display>" for EWS
  email: string;         // may be empty for EWS
  name: string;
  total: number;
  sent: number;
  received: number;
  accounts: AccountRef[];
}

interface AccountStat {
  accountId: string;
  email: string;
  name?: string;
  providerType: string;
  color?: string;
  total: number;
  sent: number;
  received: number;
}

interface TimePoint { key: string; label: string; sent: number; received: number; }

// ── Date helpers ───────────────────────────────────────────────────────────────

function startOfDay(d: Date) { const r = new Date(d); r.setHours(0, 0, 0, 0); return r; }
function endOfDay(d: Date)   { const r = new Date(d); r.setHours(23, 59, 59, 999); return r; }

function startOfWeekMonday(d: Date): Date {
  const result = startOfDay(d);
  result.setDate(result.getDate() - (result.getDay() + 6) % 7);
  return result;
}

function addOneMonthClamped(d: Date): Date {
  const result = new Date(d);
  const day = result.getDate();
  result.setDate(1);
  result.setMonth(result.getMonth() + 1);
  const lastDay = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
  result.setDate(Math.min(day, lastDay));
  return result;
}

function getDateRange(preset: PeriodPreset, customFrom?: Date | null, customTo?: Date | null): DateRange {
  const now = new Date();
  switch (preset) {
    case 'today': return { from: startOfDay(now), to: endOfDay(now) };
    case 'yesterday': {
      const y = new Date(now); y.setDate(y.getDate() - 1);
      return { from: startOfDay(y), to: endOfDay(y) };
    }
    case 'thisweek': {
      return { from: startOfWeekMonday(now), to: endOfDay(now) };
    }
    case 'lastweek': {
      const f = startOfWeekMonday(now);
      f.setDate(f.getDate() - 7);
      const t = new Date(f); t.setDate(t.getDate() + 6);
      return { from: startOfDay(f), to: endOfDay(t) };
    }
    case 'thismonth': return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: endOfDay(now) };
    case 'lastmonth': {
      const f = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const t = new Date(now.getFullYear(), now.getMonth(), 0);
      return { from: f, to: endOfDay(t) };
    }
    case 'custom': {
      const from = customFrom ? startOfDay(customFrom) : startOfDay(new Date(Date.now() - 7 * 86400000));
      const requestedTo = customTo ? endOfDay(customTo) : endOfDay(now);
      const maxTo = endOfDay(addOneMonthClamped(from));
      return {
        from,
        to: requestedTo > maxTo ? maxTo : requestedTo,
      };
    }
  }
}

function getGroupBy(range: DateRange): 'day' | 'week' | 'month' {
  const days = (range.to.getTime() - range.from.getTime()) / 86400000;
  if (days <= 31) return 'day';
  if (days <= 90) return 'week';
  return 'month';
}

function getGroupKey(date: Date, groupBy: 'day' | 'week' | 'month'): string {
  if (groupBy === 'day') {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }
  if (groupBy === 'week') {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
    const jan4 = new Date(d.getFullYear(), 0, 4);
    const w = 1 + Math.round(((d.getTime() - jan4.getTime()) / 86400000 - 3 + (jan4.getDay() + 6) % 7) / 7);
    return `${d.getFullYear()}-W${String(w).padStart(2, '0')}`;
  }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function formatGroupLabel(key: string, groupBy: 'day' | 'week' | 'month', locale: string): string {
  if (groupBy === 'day') {
    const d = new Date(key + 'T12:00:00');
    return d.toLocaleDateString(locale, { month: 'short', day: 'numeric' });
  }
  if (groupBy === 'week') {
    const [yearStr, weekStr] = key.split('-W');
    const year = parseInt(yearStr, 10);
    const week = parseInt(weekStr, 10);
    const jan4 = new Date(year, 0, 4);
    const start = new Date(jan4.getTime() + (week - 1) * 7 * 86400000 - ((jan4.getDay() + 6) % 7) * 86400000);
    return start.toLocaleDateString(locale, { month: 'short', day: 'numeric' });
  }
  const [y, m] = key.split('-');
  return new Date(parseInt(y, 10), parseInt(m, 10) - 1, 1).toLocaleDateString(locale, { month: 'short', year: '2-digit' });
}

function formatDate(d: Date, locale: string): string {
  return d.toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatAccountDomain(email: string): string {
  const domain = email.includes('@') ? email.slice(email.lastIndexOf('@') + 1) : email;
  return domain ? domain.charAt(0).toUpperCase() + domain.slice(1).toLowerCase() : domain;
}

function shiftDateByMonths(d: Date, delta: number): Date {
  const result = new Date(d);
  const day = result.getDate();
  result.setDate(1);
  result.setMonth(result.getMonth() + delta);
  const lastDay = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
  result.setDate(Math.min(day, lastDay));
  return result;
}

function shiftDateByDays(d: Date, delta: number): Date {
  const result = new Date(d);
  result.setDate(result.getDate() + delta);
  return result;
}

function getPreviousDateRange(range: DateRange, preset: PeriodPreset): DateRange {
  if (preset === 'today' || preset === 'yesterday') {
    return {
      from: shiftDateByDays(range.from, -1),
      to: shiftDateByDays(range.to, -1),
    };
  }
  if (preset === 'thisweek' || preset === 'lastweek') {
    return {
      from: shiftDateByDays(range.from, -7),
      to: shiftDateByDays(range.to, -7),
    };
  }
  if (preset === 'thismonth' || preset === 'lastmonth') {
    return { from: shiftDateByMonths(range.from, -1), to: shiftDateByMonths(range.to, -1) };
  }
  const duration = range.to.getTime() - range.from.getTime() + 1;
  const to = new Date(range.from.getTime() - 1);
  return { from: new Date(to.getTime() - duration + 1), to };
}

function EvolutionBadge({ current, previous, ready, locale, newLabel, comparisonLabel }: {
  current: number; previous: number; ready: boolean; locale: string;
  newLabel: string; comparisonLabel: string;
}) {
  if (!ready) return <span className="mail-stats-card__evolution-loading" aria-label={comparisonLabel} />;
  if (previous === 0) {
    return current === 0
      ? <span className="mail-stats-card__evolution mail-stats-card__evolution--neutral">0%</span>
      : <span className="mail-stats-card__evolution mail-stats-card__evolution--up">{newLabel}</span>;
  }
  const percent = ((current - previous) / previous) * 100;
  const formatted = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(Math.abs(percent));
  const direction = percent > 0 ? 'up' : percent < 0 ? 'down' : 'neutral';
  const prefix = percent > 0 ? '+' : percent < 0 ? '−' : '';
  return (
    <span className={`mail-stats-card__evolution mail-stats-card__evolution--${direction}`} title={comparisonLabel}>
      {prefix}{formatted}%
    </span>
  );
}

// ── Stats computation ──────────────────────────────────────────────────────────

function computeStats(
  inboxByAccount: Map<string, MailThread[]>,
  sentByAccount: Map<string, MailThread[]>,
  accounts: MailAccount[],
  dateRange: DateRange,
  groupBy: 'day' | 'week' | 'month',
  locale: string,
  identityEmails: Set<string>,
) {
  const contactMap = new Map<string, {
    email: string; name: string; total: number; sent: number; received: number;
    accountSet: Map<string, AccountRef>;
  }>();
  const accountStatsMap = new Map<string, AccountStat>();
  const timeMap = new Map<string, { sent: number; received: number }>();
  let totalReceived = 0;
  let totalSent = 0;

  // Own emails: primary account + all configured identities/aliases (JMAP, Gmail)
  const ownEmails = new Set([
    ...accounts.map(a => a.email.toLowerCase()),
    ...identityEmails,
  ]);
  // Own display names: used to filter EWS display-name self-references (no @ in to_recipients)
  const ownNames = new Set(accounts.filter(a => a.name).map(a => a.name!.toLowerCase()));

  const inRange = (t: MailThread) => {
    const d = new Date(t.last_delivery_time);
    return d >= dateRange.from && d <= dateRange.to;
  };

  const upsertContact = (
    email: string | null | undefined,
    name: string | null | undefined,
    account: MailAccount,
    kind: 'sent' | 'received',
  ) => {
    const emailNorm = email?.trim().toLowerCase();
    const nameNorm = name?.trim();
    // Skip own account addresses (primary + aliases)
    if (emailNorm && ownEmails.has(emailNorm)) return;
    // Use email (or display-name for EWS which returns names without @) as key
    const key = emailNorm || (nameNorm ? nameNorm.toLowerCase() : '');
    if (!key) return;
    // Skip own display-name self-references (EWS puts user in GlobalUniqueRecipients as name)
    if (ownNames.has(key)) return;

    let cs = contactMap.get(key);
    if (!cs) {
      cs = { email: emailNorm || '', name: nameNorm || emailNorm || key, total: 0, sent: 0, received: 0, accountSet: new Map() };
      contactMap.set(key, cs);
    }
    // Upgrade to actual email or display name when a richer value arrives later
    if (emailNorm && !cs.email) cs.email = emailNorm;
    if (nameNorm && cs.name === cs.email) cs.name = nameNorm;

    cs[kind]++;
    cs.total++;
    const accKey = account.id;
    if (!cs.accountSet.has(accKey)) {
      cs.accountSet.set(accKey, { id: account.id, email: account.email, providerType: account.providerType, color: account.color });
    }
  };

  for (const account of accounts) {
    const accStat: AccountStat = {
      accountId: account.id, email: account.email, name: account.name,
      providerType: account.providerType, color: account.color,
      total: 0, sent: 0, received: 0,
    };

    for (const thread of (inboxByAccount.get(account.id) ?? [])) {
      if (!inRange(thread)) continue;
      const key = getGroupKey(new Date(thread.last_delivery_time), groupBy);
      const tp = timeMap.get(key) ?? { sent: 0, received: 0 };
      tp.received++; timeMap.set(key, tp);
      accStat.received++; totalReceived++;
      // Prefer unique_senders (Rust-populated, own-email already filtered) over from_email/from_name.
      // EWS unique_senders uses the same display-name format as to_recipients, so keys match for merge.
      if (thread.unique_senders && thread.unique_senders.length > 0) {
        for (const s of thread.unique_senders) {
          upsertContact(s.email, s.name, account, 'received');
        }
      } else {
        upsertContact(thread.from_email, thread.from_name, account, 'received');
      }
    }

    for (const thread of (sentByAccount.get(account.id) ?? [])) {
      if (!inRange(thread)) continue;
      const key = getGroupKey(new Date(thread.last_delivery_time), groupBy);
      const tp = timeMap.get(key) ?? { sent: 0, received: 0 };
      tp.sent++; timeMap.set(key, tp);
      accStat.sent++; totalSent++;
      // A sent message concerns every explicit recipient, not only the To field.
      // Deduplicate because the same address can occasionally occur in To and Cc.
      const recipients = [...(thread.to_recipients ?? []), ...(thread.cc_recipients ?? [])];
      const seenRecipients = new Set<string>();
      for (const r of recipients) {
        const recipientKey = r.email.trim().toLowerCase() || r.name?.trim().toLowerCase();
        if (!recipientKey || seenRecipients.has(recipientKey)) continue;
        seenRecipients.add(recipientKey);
        upsertContact(r.email, r.name, account, 'sent');
      }
    }

    accStat.total = accStat.sent + accStat.received;
    accountStatsMap.set(account.id, accStat);
  }

  // Post-process: merge display-name entries into email-keyed entries for the same person.
  // EWS sometimes returns display names in GlobalUniqueSenders but SMTP in GlobalUniqueRecipients
  // for external contacts. When both exist, merge so sent/received appear on one row.
  {
    // Map: contact display-name → email-keyed entry key (only for entries with a real email)
    const nameToEmailKey = new Map<string, string>();
    for (const [key, cs] of contactMap) {
      if (key.includes('@') && cs.name && cs.name !== cs.email) {
        nameToEmailKey.set(cs.name.toLowerCase(), key);
      }
    }
    for (const [key, cs] of contactMap) {
      if (!key.includes('@')) {
        const emailKey = nameToEmailKey.get(key);  // key is already lowercase display name
        if (emailKey) {
          const target = contactMap.get(emailKey)!;
          target.received += cs.received;
          target.sent += cs.sent;
          target.total += cs.received + cs.sent;
          for (const [ak, ar] of cs.accountSet) {
            if (!target.accountSet.has(ak)) target.accountSet.set(ak, ar);
          }
          contactMap.delete(key);
        }
      }
    }
  }

  const timeSeries: TimePoint[] = Array.from(timeMap.keys()).sort().map(key => ({
    key,
    label: formatGroupLabel(key, groupBy, locale),
    sent: timeMap.get(key)!.sent,
    received: timeMap.get(key)!.received,
  }));

  const contactStats: ContactStat[] = Array.from(contactMap.entries())
    .map(([key, cs]) => ({
      key,
      email: cs.email,
      name: cs.name,
      total: cs.total,
      sent: cs.sent,
      received: cs.received,
      accounts: Array.from(cs.accountSet.values()),
    }))
    .sort((a, b) => b.total - a.total);

  return {
    totalReceived, totalSent,
    total: totalReceived + totalSent,
    timeSeries,
    accountStats: Array.from(accountStatsMap.values()),
    contactStats,
  };
}

// ── Provider brand icons ───────────────────────────────────────────────────────

function GmailIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-label="Gmail">
      <rect width="20" height="20" rx="3" fill="#EA4335" />
      <path d="M3 6.5l7 5 7-5" stroke="white" strokeWidth="1.4" strokeLinecap="round" fill="none" />
      <path d="M3 6.5V14.5H17V6.5L10 11.5L3 6.5Z" fill="white" opacity="0.18" />
      <path d="M3 6.5h14v8H3z" fill="none" stroke="white" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" opacity="0.5"/>
    </svg>
  );
}

function OutlookIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-label="Outlook">
      <rect width="20" height="20" rx="3" fill="#0078D4" />
      <rect x="3" y="5" width="8" height="10" rx="1.5" fill="#50E6FF" />
      <circle cx="7" cy="10" r="2.5" fill="#0078D4" />
      <rect x="11" y="7" width="6" height="6" rx="1" fill="white" opacity="0.85" />
    </svg>
  );
}

function ImapIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-label="IMAP">
      <rect width="20" height="20" rx="3" fill="#6366F1" />
      <rect x="3" y="6" width="14" height="9" rx="1.5" fill="white" opacity="0.9" />
      <path d="M3 7.5l7 5 7-5" stroke="#6366F1" strokeWidth="1.4" strokeLinecap="round" fill="none" />
    </svg>
  );
}

function FastmailIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-label="Fastmail">
      <rect width="20" height="20" rx="3" fill="#2C5FA8" />
      <path d="M6 5h8v1.8H8v2.2h5.5v1.8H8V15H6V5z" fill="white" />
    </svg>
  );
}

function ProviderIcon({ providerType, size = 16 }: { providerType: string; size?: number }) {
  switch (providerType) {
    case 'gmail': return <GmailIcon size={size} />;
    case 'ews':   return <OutlookIcon size={size} />;
    case 'jmap':  return <FastmailIcon size={size} />;
    default:      return <ImapIcon size={size} />;
  }
}

function AccountBadge({ account }: { account: AccountRef }) {
  const domain = formatAccountDomain(account.email);
  return (
    <span className="mail-stats-account-badge" title={account.email}>
      <ProviderIcon providerType={account.providerType} size={14} />
      <span className="mail-stats-account-badge__domain">{domain}</span>
    </span>
  );
}

// ── Mini calendar picker ───────────────────────────────────────────────────────

function MiniCalendar({
  value, rangeFrom, rangeTo, onSelect,
}: {
  value: Date | null; rangeFrom: Date | null; rangeTo: Date | null;
  onSelect: (d: Date) => void;
}) {
  const { i18n } = useTranslation();
  const locale = i18n.language;
  const todayStr = new Date().toDateString();
  const [viewYear, setViewYear] = useState(() => (value ?? new Date()).getFullYear());
  const [viewMonth, setViewMonth] = useState(() => (value ?? new Date()).getMonth());

  const nav = (delta: number) => {
    const d = new Date(viewYear, viewMonth + delta, 1);
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth());
  };

  const monthLabel = new Date(viewYear, viewMonth, 1).toLocaleDateString(locale, { month: 'long', year: 'numeric' });
  const firstDow = (new Date(viewYear, viewMonth, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const cells: (number | null)[] = [...Array(firstDow).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  const dowLabels = Array.from({ length: 7 }, (_, i) =>
    new Date(2024, 0, 1 + i).toLocaleDateString(locale, { weekday: 'short' }).slice(0, 2)
  );

  return (
    <div className="mail-stats-calendar">
      <div className="mail-stats-calendar__nav">
        <button className="mail-stats-calendar__nav-btn" onClick={() => nav(-1)} type="button">◄</button>
        <span className="mail-stats-calendar__month-label">{monthLabel}</span>
        <button className="mail-stats-calendar__nav-btn mail-stats-calendar__nav-btn--today"
          onClick={() => { setViewYear(new Date().getFullYear()); setViewMonth(new Date().getMonth()); }} type="button">●</button>
        <button className="mail-stats-calendar__nav-btn" onClick={() => nav(1)} type="button">►</button>
      </div>
      <div className="mail-stats-calendar__grid">
        {dowLabels.map(d => <span key={d} className="mail-stats-calendar__dow">{d}</span>)}
        {cells.map((day, i) => {
          if (day === null) return <span key={`e-${i}`} />;
          const cellDate = new Date(viewYear, viewMonth, day);
          const cellStr = cellDate.toDateString();
          const isSelected = value?.toDateString() === cellStr;
          const isToday = cellStr === todayStr;
          const inRange = rangeFrom && rangeTo
            ? cellDate >= startOfDay(rangeFrom) && cellDate <= endOfDay(rangeTo)
            : false;
          return (
            <button key={day} type="button"
              className={['mail-stats-calendar__day',
                isSelected && 'mail-stats-calendar__day--selected',
                isToday && !isSelected && 'mail-stats-calendar__day--today',
                inRange && !isSelected && 'mail-stats-calendar__day--range',
              ].filter(Boolean).join(' ')}
              onClick={() => onSelect(cellDate)}
            >{day}</button>
          );
        })}
      </div>
    </div>
  );
}

// ── Main modal ─────────────────────────────────────────────────────────────────

interface MailStatsModalProps {
  isOpen: boolean;
  onClose: () => void;
  allMailAccounts: MailAccount[];
  allProviders: Map<string, MailProvider>;
  /** All configured identities (aliases) for all accounts — used to exclude own addresses from contacts */
  accountIdentities?: { email: string; name?: string }[];
}

const PAGE_SIZE = 20;
const PERIOD_STORAGE_KEY = 'mail-stats-period';
const CUSTOM_FROM_STORAGE_KEY = 'mail-stats-custom-from';
const CUSTOM_TO_STORAGE_KEY = 'mail-stats-custom-to';

function storedPeriod(): PeriodPreset {
  if (typeof window === 'undefined') return 'thisweek';
  const value = localStorage.getItem(PERIOD_STORAGE_KEY);
  return ['today', 'yesterday', 'thisweek', 'lastweek', 'thismonth', 'lastmonth', 'custom'].includes(value ?? '')
    ? value as PeriodPreset
    : 'thisweek';
}

function storedDate(key: string): Date | null {
  if (typeof window === 'undefined') return null;
  const value = localStorage.getItem(key);
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function MailStatsModal({ isOpen, onClose, allMailAccounts, allProviders, accountIdentities }: MailStatsModalProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;

  const [period, setPeriod] = useState<PeriodPreset>(storedPeriod);
  const [customFrom, setCustomFrom] = useState<Date | null>(() => storedDate(CUSTOM_FROM_STORAGE_KEY));
  const [customTo, setCustomTo] = useState<Date | null>(() => storedDate(CUSTOM_TO_STORAGE_KEY));
  const [editingSide, setEditingSide] = useState<'from' | 'to' | null>(null);
  const [loading, setLoading] = useState(false);
  const [comparisonReady, setComparisonReady] = useState(false);
  const [inboxByAccount, setInboxByAccount] = useState<Map<string, MailThread[]>>(new Map());
  const [sentByAccount, setSentByAccount] = useState<Map<string, MailThread[]>>(new Map());
  const [contactPage, setContactPage] = useState(0);

  // Read CSS vars for recharts (SVG attributes don't support CSS custom properties)
  const chartColors = useMemo(() => {
    if (typeof window === 'undefined') return { primary: '#0877bd', sent: '#10b981' };
    const s = getComputedStyle(document.documentElement);
    return {
      primary: s.getPropertyValue('--primary').trim() || '#0877bd',
      sent: s.getPropertyValue('--stats-sent-color').trim() || '#10b981',
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const dateRange = useMemo(
    () => getDateRange(period, customFrom, customTo),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [period, customFrom?.toDateString(), customTo?.toDateString()]
  );
  const groupBy = useMemo(() => getGroupBy(dateRange), [dateRange]);

  const accountKey = allMailAccounts.map(a => a.id).join(',');

  useEffect(() => {
    localStorage.setItem(PERIOD_STORAGE_KEY, period);
    if (customFrom) localStorage.setItem(CUSTOM_FROM_STORAGE_KEY, customFrom.toISOString());
    if (customTo) localStorage.setItem(CUSTOM_TO_STORAGE_KEY, customTo.toISOString());
  }, [period, customFrom, customTo]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setLoading(true);
    setComparisonReady(false);
    setContactPage(0);

    const fetchAll = async () => {
      const inbox = new Map<string, MailThread[]>();
      const sent = new Map<string, MailThread[]>();

      // Folders whose threads count as "sent" or should be skipped entirely
      const SENT_IDS   = new Set(['sentitems', 'sent', 'sent mail']);
      const SKIP_IDS   = new Set(['drafts', 'deleteditems', 'trash', 'spam', 'junkemail', 'junk', 'snoozed']);
      const SKIP_NAMES = new Set(['sent', 'sent items', 'sent mail', 'drafts', 'brouillons',
                                   'trash', 'deleted items', 'éléments supprimés', 'spam',
                                   'junk', 'junk email', 'indésirables']);

      await Promise.all(
        allMailAccounts.map(async (account) => {
          const provider = allProviders.get(account.id);
          if (!provider) return;
          // JMAP's listThreads internally multiplies maxCount×4 → use 50 to stay within server limits.
          const maxCount = account.providerType === 'jmap' ? 50 : 200;
          try {
            // Discover all folders so custom/rule-filtered folders are included
            const folders = await provider.listFolders().catch(() => []);
            console.log(`[MailStats] ${account.email} — listFolders:`, folders.map(f => `${f.folder_id}=${f.display_name}`));
            const receivedFolderIds = folders
              .filter(f => {
                const id = f.folder_id.toLowerCase();
                const name = f.display_name.toLowerCase();
                const keep = !SENT_IDS.has(id) && !SKIP_IDS.has(id) && !SKIP_NAMES.has(name);
                if (!keep) console.log(`[MailStats]   ↳ skip "${f.display_name}" (id=${f.folder_id})`);
                return keep;
              })
              .map(f => f.folder_id);

            console.log(`[MailStats] ${account.email} — fetchFolders (${receivedFolderIds.length}):`, receivedFolderIds);
            // Fall back to inbox only if folder listing failed
            const fetchFolders = receivedFolderIds.length > 0 ? receivedFolderIds : ['inbox'];

            const [receivedArrays, sentThreads] = await Promise.all([
              Promise.all(fetchFolders.map(async (fid) => {
                const threads = await provider.listThreads(fid, maxCount).catch(() => [] as MailThread[]);
                console.log(`[MailStats]   folder ${fid} → ${threads.length} threads`);
                return threads;
              })),
              provider.listThreads('sentitems', maxCount).catch(() => [] as MailThread[]),
            ]);

            // Deduplicate by conversation_id across all received folders
            const receivedMap = new Map<string, MailThread>();
            for (const threads of receivedArrays) {
              for (const t of threads) {
                if (!receivedMap.has(t.conversation_id)) receivedMap.set(t.conversation_id, t);
              }
            }

            inbox.set(account.id, Array.from(receivedMap.values()));
            sent.set(account.id, sentThreads);
          } catch {
            inbox.set(account.id, []);
            sent.set(account.id, []);
          }
        })
      );
      if (!cancelled) {
        setInboxByAccount(inbox);
        setSentByAccount(sent);
        setLoading(false);
      }
    };

    fetchAll();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, accountKey, allProviders, period, customFrom?.toDateString(), customTo?.toDateString()]);

  const identityEmails = useMemo(
    () => new Set((accountIdentities ?? []).map(i => i.email.toLowerCase())),
    [accountIdentities]
  );

  const stats = useMemo(
    () => computeStats(inboxByAccount, sentByAccount, allMailAccounts, dateRange, groupBy, locale, identityEmails),
    [inboxByAccount, sentByAccount, allMailAccounts, dateRange, groupBy, locale, identityEmails]
  );

  const previousDateRange = useMemo(() => getPreviousDateRange(dateRange, period), [dateRange, period]);
  const previousStats = useMemo(
    () => computeStats(inboxByAccount, sentByAccount, allMailAccounts, previousDateRange, groupBy, locale, identityEmails),
    [inboxByAccount, sentByAccount, allMailAccounts, previousDateRange, groupBy, locale, identityEmails]
  );

  // Let React paint the current period first, then reveal the comparison in a
  // distinct render so it never delays the main table.
  useEffect(() => {
    if (!isOpen || loading) return;
    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => setComparisonReady(true));
    });
    return () => {
      cancelAnimationFrame(firstFrame);
      if (secondFrame) cancelAnimationFrame(secondFrame);
    };
  }, [isOpen, loading, dateRange]);

  const visibleContacts = stats.contactStats.slice(contactPage * PAGE_SIZE, (contactPage + 1) * PAGE_SIZE);
  const totalPages = Math.ceil(stats.contactStats.length / PAGE_SIZE);

  const handleSelectDate = (d: Date) => {
    if (editingSide === 'from') {
      setCustomFrom(d);
      const maxTo = addOneMonthClamped(d);
      if (!customTo || customTo < d) setCustomTo(d);
      else if (customTo > maxTo) setCustomTo(maxTo);
      setEditingSide('to');
    } else {
      if (customFrom && d < customFrom) {
        const maxTo = addOneMonthClamped(d);
        setCustomFrom(d);
        setCustomTo(customFrom > maxTo ? maxTo : customFrom);
      } else if (customFrom && d > addOneMonthClamped(customFrom)) {
        setCustomTo(addOneMonthClamped(customFrom));
      } else {
        setCustomTo(d);
      }
      setEditingSide(null);
    }
    setContactPage(0);
  };

  const presets: { key: PeriodPreset; label: string }[] = [
    { key: 'today',     label: t('mail.stats.period.today',     "Aujourd'hui") },
    { key: 'yesterday', label: t('mail.stats.period.yesterday', 'Hier') },
    { key: 'thisweek',  label: t('mail.stats.period.thisweek',  'Cette semaine') },
    { key: 'lastweek',  label: t('mail.stats.period.lastweek',  'Semaine dernière') },
    { key: 'thismonth', label: t('mail.stats.period.thismonth', 'Ce mois') },
    { key: 'lastmonth', label: t('mail.stats.period.lastmonth', 'Mois dernier') },
    { key: 'custom',    label: t('mail.stats.period.custom',    'Personnalisé') },
  ];

  if (!isOpen) return null;

  const customFromDisp = customFrom ? formatDate(customFrom, locale) : '—';
  const customToDisp   = customTo   ? formatDate(customTo,   locale) : '—';

  const chartData = stats.timeSeries.map(p => ({
    name: p.label,
    [t('mail.stats.received', 'Reçus')]: p.received,
    [t('mail.stats.sent', 'Envoyés')]:   p.sent,
  }));

  const tooltipStyle = {
    background: 'var(--bg)',
    border: '1px solid var(--border)',
    borderRadius: '8px',
    fontSize: 12,
    color: 'var(--text)',
  };

  return createPortal(
    <div className="mail-stats-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="mail-stats-dialog" role="dialog" aria-modal="true">

        {/* Header */}
        <div className="mail-stats-header">
          <span className="mail-stats-title">{t('mail.stats.title', 'Statistiques mail')}</span>
          <button className="btn-icon" onClick={onClose} title={t('common.close', 'Fermer')}><X size={18} /></button>
        </div>

        {/* Period */}
        <div className="mail-stats-period">
          <div className="mail-stats-period-row">
            {presets.map(p => (
              <button key={p.key} type="button"
                className={`mail-stats-period-btn${period === p.key ? ' mail-stats-period-btn--active' : ''}`}
                onClick={() => { setPeriod(p.key); setEditingSide(null); setContactPage(0); }}>
                {p.label}
              </button>
            ))}
            {period === 'custom' && (
              <div className="mail-stats-period-dates">
                <button type="button"
                  className={`mail-stats-date-btn${editingSide === 'from' ? ' mail-stats-date-btn--active' : ''}`}
                  onClick={() => setEditingSide(s => s === 'from' ? null : 'from')}>
                  {customFromDisp}
                </button>
                <span className="mail-stats-period-sep">→</span>
                <button type="button"
                  className={`mail-stats-date-btn${editingSide === 'to' ? ' mail-stats-date-btn--active' : ''}`}
                  onClick={() => setEditingSide(s => s === 'to' ? null : 'to')}>
                  {customToDisp}
                </button>
              </div>
            )}
          </div>
          {period === 'custom' && editingSide !== null && (
            <MiniCalendar
              value={editingSide === 'from' ? customFrom : customTo}
              rangeFrom={customFrom} rangeTo={customTo}
              onSelect={handleSelectDate}
            />
          )}
        </div>

        {/* Content */}
        <div className="mail-stats-body">
          {loading ? (
            <>
              <div className="mail-stats-skeleton-cards">
                <div className="mail-stats-skeleton mail-stats-skeleton-card" />
                <div className="mail-stats-skeleton mail-stats-skeleton-card" />
                <div className="mail-stats-skeleton mail-stats-skeleton-card" />
              </div>
              <div className="mail-stats-skeleton mail-stats-skeleton-chart" />
              <div className="mail-stats-skeleton-rows">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="mail-stats-skeleton mail-stats-skeleton-row" />
                ))}
              </div>
            </>
          ) : (
            <>
              {/* KPI cards */}
              <div className="mail-stats-cards">
                <div className="mail-stats-card">
                  <div className="mail-stats-card__icon"><MessageSquare size={16} /></div>
                  <span className="mail-stats-card__value">{stats.total.toLocaleString(locale)}</span>
                  <span className="mail-stats-card__label">{t('mail.stats.total', 'Total')}</span>
                  <EvolutionBadge current={stats.total} previous={previousStats.total} ready={comparisonReady}
                    locale={locale} newLabel={t('mail.stats.evolutionNew', 'Nouveau')}
                    comparisonLabel={t('mail.stats.comparedToPrevious', 'Par rapport à la période précédente')} />
                </div>
                <div className="mail-stats-card mail-stats-card--sent">
                  <div className="mail-stats-card__icon"><Send size={16} /></div>
                  <span className="mail-stats-card__value">{stats.totalSent.toLocaleString(locale)}</span>
                  <span className="mail-stats-card__label">{t('mail.stats.sent', 'Envoyés')}</span>
                  <EvolutionBadge current={stats.totalSent} previous={previousStats.totalSent} ready={comparisonReady}
                    locale={locale} newLabel={t('mail.stats.evolutionNew', 'Nouveau')}
                    comparisonLabel={t('mail.stats.comparedToPrevious', 'Par rapport à la période précédente')} />
                </div>
                <div className="mail-stats-card mail-stats-card--received">
                  <div className="mail-stats-card__icon"><Users size={16} /></div>
                  <span className="mail-stats-card__value">{stats.totalReceived.toLocaleString(locale)}</span>
                  <span className="mail-stats-card__label">{t('mail.stats.received', 'Reçus')}</span>
                  <EvolutionBadge current={stats.totalReceived} previous={previousStats.totalReceived} ready={comparisonReady}
                    locale={locale} newLabel={t('mail.stats.evolutionNew', 'Nouveau')}
                    comparisonLabel={t('mail.stats.comparedToPrevious', 'Par rapport à la période précédente')} />
                </div>
              </div>

              {/* Chart */}
              {stats.timeSeries.length > 0 && (
                <div className="mail-stats-section">
                  <div className="mail-stats-section-title">{t('mail.stats.evolution', 'Activité des messages')}</div>
                  <div className="mail-stats-chart">
                    <ResponsiveContainer width="100%" height={200}>
                      <BarChart data={chartData} margin={{ top: 8, right: 8, left: -10, bottom: 0 }} barSize={Math.max(8, Math.min(32, 500 / Math.max(chartData.length, 1)))}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                        <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'var(--text-muted)' } as any} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                        <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' } as any} tickLine={false} axisLine={false} width={36} allowDecimals={false} />
                        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'var(--bg-hover)' }} />
                        <Legend iconSize={10} iconType="square" wrapperStyle={{ fontSize: 12, paddingTop: 6 }} />
                        <Bar dataKey={t('mail.stats.received', 'Reçus')} stackId="a" fill={chartColors.primary} radius={[0, 0, 0, 0]} />
                        <Bar dataKey={t('mail.stats.sent', 'Envoyés')} stackId="a" fill={chartColors.sent} radius={[3, 3, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {/* Per-account blocks */}
              {stats.accountStats.length > 0 && (
                <div className="mail-stats-section">
                  <div className="mail-stats-section-title">{t('mail.stats.byAccount', 'Messages par instance')}</div>
                  <div className="mail-stats-accounts">
                    {stats.accountStats.map(acc => (
                      <div key={acc.accountId} className="mail-stats-account-block">
                        <div className="mail-stats-account-block__header">
                          <ProviderIcon providerType={acc.providerType} size={18} />
                          <span className="mail-stats-account-block__email" title={acc.email}>
                            {formatAccountDomain(acc.email)}
                          </span>
                        </div>
                        <div className="mail-stats-account-block__nums">
                          <span className="mail-stats-account-block__num">
                            <strong>{acc.total}</strong>
                            <span>{t('mail.stats.total', 'Total')}</span>
                          </span>
                          <span className="mail-stats-account-block__num">
                            <strong>{acc.sent}</strong>
                            <span>{t('mail.stats.sent', 'Envoyés')}</span>
                          </span>
                          <span className="mail-stats-account-block__num">
                            <strong>{acc.received}</strong>
                            <span>{t('mail.stats.received', 'Reçus')}</span>
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Top contacts */}
              {stats.contactStats.length > 0 && (
                <div className="mail-stats-section">
                  <div className="mail-stats-section-title">
                    {t('mail.stats.topContacts', 'Messages par contact')}
                    <span className="mail-stats-section-count">({stats.contactStats.length})</span>
                  </div>
                  <table className="mail-stats-table">
                    <thead>
                      <tr>
                        <th>{t('mail.stats.col.contact', 'Contact')}</th>
                        <th>{t('mail.stats.col.source', 'Compte')}</th>
                        <th className="mail-stats-table__num">{t('mail.stats.col.total', 'Total')}</th>
                        <th className="mail-stats-table__num">{t('mail.stats.col.sent', 'Envoyés')}</th>
                        <th className="mail-stats-table__num">{t('mail.stats.col.received', 'Reçus')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleContacts.map((cs) => {
                        const hasRealEmail = cs.email.includes('@');
                        const displayName = cs.name || cs.email;
                        return (
                        <tr key={cs.key}>
                          <td>
                            <div className="mail-stats-contact-cell">
                              <ContactAvatar email={cs.email || cs.name} name={displayName} size={28} />
                              <div className="mail-stats-contact-cell__info">
                                {displayName && <span className="mail-stats-contact-cell__name">{displayName}</span>}
                                {hasRealEmail && cs.email !== displayName && (
                                  <span className="mail-stats-contact-cell__email">{cs.email}</span>
                                )}
                              </div>
                            </div>
                          </td>
                          <td>
                            <div className="mail-stats-source-cell">
                              {cs.accounts.map((acc) => (
                                <AccountBadge key={acc.id} account={acc} />
                              ))}
                            </div>
                          </td>
                          <td className="mail-stats-table__num"><strong>{cs.total}</strong></td>
                          <td className="mail-stats-table__num">{cs.sent}</td>
                          <td className="mail-stats-table__num">{cs.received}</td>
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>

                  {totalPages > 1 && (
                    <div className="mail-stats-pagination">
                      <button className="btn-icon" disabled={contactPage === 0}
                        onClick={() => setContactPage(p => p - 1)} type="button">
                        <ArrowLeft size={16} />
                      </button>
                      <span className="mail-stats-pagination__label">
                        {t('mail.stats.page', '{{from}}–{{to}} sur {{total}}', {
                          from: contactPage * PAGE_SIZE + 1,
                          to: Math.min((contactPage + 1) * PAGE_SIZE, stats.contactStats.length),
                          total: stats.contactStats.length,
                        })}
                      </span>
                      <button className="btn-icon" disabled={contactPage >= totalPages - 1}
                        onClick={() => setContactPage(p => p + 1)} type="button">
                        <ArrowRight size={16} />
                      </button>
                    </div>
                  )}
                </div>
              )}

              {stats.total === 0 && (
                <div className="mail-stats-empty">{t('mail.stats.noData', 'Aucune donnée sur cette période.')}</div>
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
