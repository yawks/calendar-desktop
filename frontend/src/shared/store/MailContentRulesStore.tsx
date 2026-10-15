import { createContext, useContext, useState, type ReactNode } from 'react';
import { useVault } from '../security/VaultProvider';

export const MAIL_CONTENT_RULES_KEY = 'courrier:mail-content-rules';
export interface MailContentRule { id: string; text: string; enabled: boolean }
const RulesContext = createContext<{ rules: MailContentRule[]; save: (rules: MailContentRule[]) => void }>({ rules: [], save: () => {} });

export function MailContentRulesProvider({ children }: { children: ReactNode }) {
  const vault = useVault();
  const [rules, setRules] = useState<MailContentRule[]>(() => {
    const stored = vault.read<unknown>(MAIL_CONTENT_RULES_KEY, []);
    return Array.isArray(stored) ? stored.filter((rule): rule is MailContentRule =>
      !!rule && typeof rule.id === 'string' && typeof rule.text === 'string' && typeof rule.enabled === 'boolean') : [];
  });
  const save = (next: MailContentRule[]) => { vault.write(MAIL_CONTENT_RULES_KEY, next); setRules(next); };
  return <RulesContext.Provider value={{ rules, save }}>{children}</RulesContext.Provider>;
}
export const useMailContentRules = () => useContext(RulesContext);
