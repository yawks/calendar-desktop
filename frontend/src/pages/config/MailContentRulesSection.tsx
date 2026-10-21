import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Filter, Pencil, Trash2 } from 'lucide-react';
import { useMailContentRules } from '../../shared/store/MailContentRulesStore';

export function MailContentRulesSection() {
  const { t } = useTranslation();
  const { rules, save } = useMailContentRules();
  const [text, setText] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!text.trim()) return;
    save(editing ? rules.map(rule => rule.id === editing ? { ...rule, text: text.trim() } : rule)
      : [...rules, { id: crypto.randomUUID(), text: text.trim(), enabled: true }]);
    setText(''); setEditing(null); setSaved(true);
  };
  return <section className="native-settings-card preferences-card config-mail-rules">
    <header className="native-settings-card__header">
      <div className="native-settings-card__icon" aria-hidden="true"><Filter size={20} /></div>
      <div><h3>{t('settings.mailContentRules.title')}</h3><p>{t('settings.mailContentRules.hint')}</p></div>
    </header>
    <form className="config-mail-rules__form" onSubmit={submit}>
      <label className="native-settings-field"><span>{t('settings.mailContentRules.text')}</span>
        <textarea required rows={4} value={text} onChange={event => { setText(event.target.value); setSaved(false); }} />
      </label>
      <div className="native-settings-actions">
        <button type="submit" className="btn-primary" disabled={!text.trim()}>{t(editing ? 'settings.mailContentRules.save' : 'settings.mailContentRules.add')}</button>
        {editing && <button type="button" className="btn-ghost" onClick={() => { setEditing(null); setText(''); }}>{t('settings.mailContentRules.cancel')}</button>}
      </div>
    </form>
    {rules.length > 0 ? <ul className="config-mail-rules__list">{rules.map(rule => <li key={rule.id}>
      <label className="preferences-toggle"><input type="checkbox" checked={rule.enabled} onChange={event => { save(rules.map(item => item.id === rule.id ? { ...item, enabled: event.target.checked } : item)); setSaved(true); }} /><span>{t('settings.mailContentRules.enabled')}</span></label>
      <p className="config-mail-rules__text">{rule.text}</p>
      <div className="native-settings-actions">
        <button type="button" className="btn-ghost" onClick={() => { setText(rule.text); setEditing(rule.id); setSaved(false); }}><Pencil size={16} />{t('settings.mailContentRules.edit')}</button>
        <button type="button" className="btn-ghost config-mail-rules__delete" onClick={() => { save(rules.filter(item => item.id !== rule.id)); if (editing === rule.id) { setEditing(null); setText(''); } setSaved(true); }}><Trash2 size={16} />{t('settings.mailContentRules.delete')}</button>
      </div>
    </li>)}</ul> : <p className="config-mail-rules__help">{t('settings.mailContentRules.empty')}</p>}
    <p className="config-mail-rules__help">{t('settings.mailContentRules.sync')}</p>
    {saved && <p className="config-mail-rules__help" role="status">{t('settings.mailContentRules.saved')}</p>}
  </section>;
}
