// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { RecipientInput } from './RecipientInput';

vi.mock('../hooks/useContactSuggestions', () => ({ useProviderContactSearch: () => [] }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }) }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

for (const source of ['to', 'cc', 'bcc']) {
  for (const target of ['to', 'cc', 'bcc'].filter(field => field !== source)) {
    it(`drags the recipient label from ${source} into the ${target} field`, async () => {
      const host = document.createElement('div');
      document.body.appendChild(host);
      const root = createRoot(host);
      const entry = { email: 'contact@example.test', name: 'Contact' };
      const onDrop = vi.fn();
      await act(async () => root.render(<>
        <RecipientInput value={[entry]} contacts={[]} onChange={vi.fn()} fieldId={source} />
        <div className="mail-composer__field">
          <span className="mail-composer__label">{target}</span>
          <RecipientInput value={[]} contacts={[]} onChange={vi.fn()} fieldId={target} onDropFromOtherField={onDrop} />
        </div>
      </>));
      const data = new Map<string, string>();
      const dataTransfer = {
        types: [] as string[], effectAllowed: '', dropEffect: '',
        setData(type: string, value: string) { data.set(type, value); this.types.push(type); },
        getData(type: string) { return data.get(type) ?? ''; },
      };
      const dispatch = (element: Element, type: string) => {
        const event = new Event(type, { bubbles: true, cancelable: true });
        Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
        element.dispatchEvent(event);
        return event;
      };
      const label = host.querySelector<HTMLButtonElement>('.recipient-chip__label')!;
      expect(label.draggable).toBe(true);
      await act(async () => { dispatch(label, 'dragstart'); });
      const targetContainer = host.querySelector('.mail-composer__field')!;
      await act(async () => {
        expect(dispatch(targetContainer, 'dragover').defaultPrevented).toBe(true);
        dispatch(targetContainer.querySelector('.mail-composer__label')!, 'dragenter');
      });
      expect(targetContainer.querySelector('.recipient-input__chips--drag-over')).not.toBeNull();
      await act(async () => {
        dispatch(targetContainer.querySelector('.mail-composer__label')!, 'drop');
      });
      expect(dataTransfer.dropEffect).toBe('move');
      expect(onDrop).toHaveBeenCalledTimes(1);
      expect(onDrop).toHaveBeenCalledWith(entry, source);
      await act(async () => root.unmount());
      host.remove();
    });
  }
}
