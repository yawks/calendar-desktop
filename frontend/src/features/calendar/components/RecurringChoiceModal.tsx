import { useTranslation } from 'react-i18next';

interface Props {
  readonly onChoice: (scope: 'this' | 'all' | null) => void;
}

export default function RecurringChoiceModal({ onChoice }: Props) {
  const { t } = useTranslation();
  console.log('[recurring] RecurringChoiceModal rendered');

  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.45)', zIndex: 10000 }}>
      <div className="modal" style={{ width: 320, maxWidth: '90%' }}>
        <div className="modal-header" style={{ background: 'var(--primary)' }}>
          <span className="modal-title">{t('recurringChoice.title')}</span>
        </div>
        <div className="modal-body" style={{ padding: '16px 20px 20px' }}>
          <p style={{ color: 'var(--text-muted)', fontSize: 'calc(14px * var(--font-scale, 1))', margin: '0 0 16px', lineHeight: 1.5 }}>
            {t('recurringChoice.description')}
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button
              type="button"
              className="btn-primary"
              style={{ width: '100%' }}
              onClick={() => onChoice('this')}
            >
              {t('recurringChoice.thisEvent')}
            </button>
            <button
              type="button"
              className="btn-primary"
              style={{ width: '100%' }}
              onClick={() => onChoice('all')}
            >
              {t('recurringChoice.allEvents')}
            </button>
          </div>
        </div>
        <div style={{ padding: '8px 20px 16px', display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid var(--border)' }}>
          <button
            type="button"
            className="btn-cancel"
            onClick={() => onChoice(null)}
          >
            {t('recurringChoice.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}
