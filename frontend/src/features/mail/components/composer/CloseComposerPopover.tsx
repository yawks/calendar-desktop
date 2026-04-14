import { X } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';

export function CloseComposerPopover({ onSaveDraft, onDiscard }: { readonly onSaveDraft: () => void; readonly onDiscard: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <button type="button" className="btn-icon" onClick={() => setOpen(o => !o)} title="Fermer"><X size={18} /></button>
      {open && (
        <div className="mail-composer__close-popover">
          <p>Enregistrer ce brouillon ?</p>
          <div className="mail-composer__close-actions">
            <button type="button" className="btn-secondary" onClick={onDiscard}>Supprimer</button>
            <button type="button" className="btn-primary" onClick={onSaveDraft}>Enregistrer</button>
          </div>
        </div>
      )}
    </div>
  );
}
