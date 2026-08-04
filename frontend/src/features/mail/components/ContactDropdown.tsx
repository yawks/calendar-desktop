import { useEffect, useRef } from 'react';

import type { MailProvider } from '../providers/MailProvider';
import { ContactAvatar } from './ContactAvatar';
import type { RecipientEntry } from './RecipientInput';

interface ContactDropdownProps {
  readonly items: RecipientEntry[];
  readonly activeIndex: number;
  readonly onSelect: (entry: RecipientEntry) => void;
  readonly provider?: Pick<MailProvider, 'accountId' | 'providerType' | 'getContactPhoto'> | null;
}

export function ContactDropdown({ items, activeIndex, onSelect, provider }: ContactDropdownProps) {
  const listRef = useRef<HTMLUListElement>(null);
  const activeRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    if (!activeRef.current || !listRef.current) return;
    const list = listRef.current;
    const item = activeRef.current;
    const { offsetTop, offsetHeight } = item;
    if (offsetTop < list.scrollTop) {
      list.scrollTop = offsetTop;
    } else if (offsetTop + offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = offsetTop + offsetHeight - list.clientHeight;
    }
  }, [activeIndex]);

  return (
    <ul ref={listRef} className="attendee-dropdown recipient-dropdown">
      {items.map((c, i) => (
        <li
          key={c.email}
          ref={i === activeIndex ? activeRef : null}
          className={`attendee-dropdown-item${i === activeIndex ? ' attendee-dropdown-item--active' : ''}`}
          onMouseDown={e => { e.preventDefault(); onSelect(c); }}
        >
          <ContactAvatar email={c.email} name={c.name} provider={provider} size={28} />
          {c.name ? (
            <>
              <span className="attendee-dropdown-name">{c.name}</span>
              <span className="attendee-dropdown-email">{c.email}</span>
            </>
          ) : (
            <span className="attendee-dropdown-name">{c.email}</span>
          )}
        </li>
      ))}
    </ul>
  );
}
