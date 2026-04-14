import { MailFolder } from './types';
import { DISPLAY_TO_STATIC } from './constants';

export function buildUnreadCounts(folders: MailFolder[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const f of folders) {
    const key = DISPLAY_TO_STATIC[f.display_name.toLowerCase()] ?? f.folder_id;
    counts[key] = f.unread_count;
  }
  return counts;
}
