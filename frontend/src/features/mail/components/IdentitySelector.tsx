import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { MailIdentity } from '../types';

interface IdentitySelectorProps {
  readonly identities: MailIdentity[];
  readonly selectedIdentityId?: string;
  readonly onSelect: (id: string) => void;
  /** When provided, renders a label prefix (e.g. "De" in the composer) */
  readonly label?: string;
  readonly className?: string;
  readonly style?: React.CSSProperties;
}

export function IdentitySelector({
  identities,
  selectedIdentityId,
  onSelect,
  label,
  className,
  style,
}: IdentitySelectorProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const sel = identities.find(i => i.id === selectedIdentityId) ?? identities[0];

  const isMultiAccount = identities.some(
    (i, _, arr) => i.accountId && i.accountId !== arr[0].accountId
  );
  const groups: { label: string; color?: string; items: MailIdentity[] }[] | null = isMultiAccount
    ? (() => {
        const map = new Map<string, { label: string; color?: string; items: MailIdentity[] }>();
        for (const id of identities) {
          const key = id.accountId ?? '__single__';
          if (!map.has(key)) map.set(key, { label: id.accountLabel ?? '', color: id.accountColor, items: [] });
          map.get(key)!.items.push(id);
        }
        return [...map.values()];
      })()
    : null;

  useEffect(() => {
    if (!open) return;
    const handler = (e: Event) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  if (!sel) return null;

  const activeId = selectedIdentityId ?? identities[0]?.id;

  return (
    <div
      ref={ref}
      className={`identity-selector${className ? ` ${className}` : ''}`}
      style={{ position: 'relative', ...style }}
    >
      {label && <span className="mail-composer__label">{label}</span>}
      <button type="button" className="from-account-btn" onClick={() => setOpen(o => !o)}>
        <span className="from-account-name" style={{ color: sel.accountColor ?? 'var(--primary)' }}>
          {sel.name ?? sel.email}
        </span>
        <span className="from-account-email">
          {sel.name && sel.name !== sel.email ? `<${sel.email}>` : ''}
        </span>
        {identities.length > 1 && <ChevronDown size={12} style={{ marginLeft: 'auto', opacity: 0.5 }} />}
      </button>

      {open && identities.length > 1 && (
        <ul className="from-account-dropdown">
          {groups ? (
            groups.map(group => (
              <React.Fragment key={group.label}>
                <li className="from-account-group-header" style={{ color: group.color }}>
                  {group.label}
                </li>
                {group.items.map(id => (
                  <li
                    key={id.id}
                    className={`from-account-option from-account-option--grouped${id.id === activeId ? ' from-account-option--active' : ''}`}
                    onClick={() => { onSelect(id.id); setOpen(false); }}
                  >
                    <span className="from-account-name" style={{ color: group.color ?? 'var(--primary)' }}>
                      {id.name ?? id.email}
                    </span>
                    <span className="from-account-email">
                      {id.name && id.name !== id.email ? `<${id.email}>` : ''}
                    </span>
                  </li>
                ))}
              </React.Fragment>
            ))
          ) : (
            identities.map(id => (
              <li
                key={id.id}
                className={`from-account-option${id.id === activeId ? ' from-account-option--active' : ''}`}
                onClick={() => { onSelect(id.id); setOpen(false); }}
              >
                <span className="from-account-name" style={{ color: id.accountColor ?? 'var(--primary)' }}>
                  {id.name ?? id.email}
                </span>
                <span className="from-account-email">
                  {id.name && id.name !== id.email ? `<${id.email}>` : ''}
                </span>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
