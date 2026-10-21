import { useId } from 'react';
import { useTranslation } from 'react-i18next';

interface Props {
  readonly onChoice: (scope: 'this' | 'all' | null) => void;
}

export default function RecurringChoiceModal({ onChoice }: Props) {
  const { t } = useTranslation();
  const titleId = useId();
  const descriptionId = useId();

  return (
    <div className="recurring-choice-backdrop">
      <div
        className="modal recurring-choice-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <div className="modal-header recurring-choice-modal__header">
          <span id={titleId} className="modal-title">{t('recurringChoice.title')}</span>
        </div>
        <div className="modal-body recurring-choice-modal__body">
          <p id={descriptionId} className="recurring-choice-modal__description">
            {t('recurringChoice.description')}
          </p>
          <div className="recurring-choice-modal__choices">
            <button
              type="button"
              className="btn-primary"
              onClick={() => onChoice('this')}
            >
              {t('recurringChoice.thisOccurrence')}
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={() => onChoice('all')}
            >
              {t('recurringChoice.entireSeries')}
            </button>
          </div>
        </div>
        <div className="recurring-choice-modal__footer">
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
