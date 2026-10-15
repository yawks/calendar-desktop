// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import RecurrenceEditor from './RecurrenceEditor';
import '../../../i18n';
let container: HTMLDivElement;
let root: Root;
const changed = vi.fn();
const editing = vi.fn();
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  changed.mockClear(); editing.mockClear();
});
afterEach(() => { act(() => root.unmount()); container.remove(); });
function render(existing = false, exchange = false) {
  function Harness() {
    const [value, setValue] = useState<string>();
    return <RecurrenceEditor start="2026-10-15T16:00" allDay={false} existing={existing} initialRule={existing ? 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH;COUNT=13' : undefined} value={value} onChange={rule => { changed(rule); setValue(rule); }} onEditingChange={editing} exchange={exchange} />;
  }
  act(() => root.render(<Harness />));
}
function choose(value: string) {
  act(() => { const select = container.querySelector('select')!; select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })); });
}
function click(selector: string) { act(() => container.querySelector<HTMLButtonElement>(selector)!.click()); }
it('prefills a loaded rule and only commits the custom rule when Done is pressed', () => {
  render(true); choose('custom');
  expect(container.querySelector<HTMLInputElement>('input[type="number"]')!.value).toBe('2');
  expect(container.querySelectorAll('[aria-pressed="true"]')).toHaveLength(2);
  expect(changed).not.toHaveBeenCalled();
  expect(editing).toHaveBeenLastCalledWith(true);
  click('.event-recurrence__actions .btn-primary');
  expect(changed).toHaveBeenLastCalledWith('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH;COUNT=13');
  expect(editing).toHaveBeenLastCalledWith(false);
  expect(container.querySelector('[role="status"]')).not.toBeNull();
});
it('cancels a draft without changing recurrence', () => {
  render(); choose('custom'); click('.event-recurrence__actions .btn-ghost');
  expect(changed).not.toHaveBeenCalled();
  expect(editing).toHaveBeenLastCalledWith(false);
});
it('rejects a weekly rule with no day and announces the error', () => {
  render(); choose('custom'); click('[aria-pressed="true"]'); click('.event-recurrence__actions .btn-primary');
  expect(changed).not.toHaveBeenCalled();
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
});
it('provides quick choices and an explicit option to preserve the current rule', () => {
  render(true); choose('daily'); expect(changed).toHaveBeenLastCalledWith('FREQ=DAILY;INTERVAL=1');
  choose('existing'); expect(changed).toHaveBeenLastCalledWith(undefined);
  choose('none'); expect(changed).toHaveBeenLastCalledWith('');
});
