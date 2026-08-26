import type { MailThread } from '../types';

/** Keep conversation details stable while refreshing list-owned metadata. */
export function mergeSelectedThread(current: MailThread, listed: MailThread): MailThread {
  const merged: MailThread = {
    ...listed,
    // EWS can report a recall request's subject as the conversation topic while
    // the item-level request still resolves the original message subject.
    topic: current.topic || listed.topic,
    snippet: current.snippet || listed.snippet,
    from_name: current.from_name || listed.from_name,
    from_email: current.from_email || listed.from_email,
  };
  const keys = new Set([...Object.keys(current), ...Object.keys(merged)]) as Set<keyof MailThread>;
  return [...keys].every(key => current[key] === merged[key]) ? current : merged;
}
