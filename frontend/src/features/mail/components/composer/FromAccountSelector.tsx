import { ChevronDown } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';

interface FromAccount {
  id: string;
  email: string;
  name?: string;
  color?: string;
}

export function FromAccountSelector({ accounts, selectedId, onChange, label }: {
  readonly accounts: FromAccount[];
  readonly selectedId: string;
  readonly onChange: (id: string) => void;
  readonly label: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = accounts.find(a => a.id === selectedId) ?? accounts[0];

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div className="mail-composer__field" ref={ref} style={{ position: 'relative' }}>
      <span className="mail-composer__label">{label}:</span>
      <button
        type="button"
        className="from-account-btn"
        onClick={() => setOpen(o => !o)}
      >
        <span className="from-account-name" style={{ color: selected?.color ?? 'var(--primary)' }}>{selected?.name ?? selected?.email}</span>
        <span className="from-account-email">{selected?.name ? `<${selected.email}>` : ''}</span>
        <ChevronDown size={12} style={{ marginLeft: 'auto', opacity: 0.5 }} />
      </button>
      {open && (
        <ul className="from-account-dropdown">
          {accounts.map(a => (
            <li
              key={a.id}
              className={`from-account-option${a.id === selectedId ? ' from-account-option--active' : ''}`}
              onClick={() => { onChange(a.id); setOpen(false); }}
            >
              <span className="from-account-name" style={{ color: a.color ?? 'var(--primary)' }}>{a.name ?? a.email}</span>
              <span className="from-account-email">{a.name ? `<${a.email}>` : ''}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
