export const ALL_ACCOUNTS_ID = '__all__';
export const SIDEBAR_MIN = 150;
export const SIDEBAR_MAX = 300;
export const THREADLIST_MIN = 200;
export const THREADLIST_MAX = 500;

export const DISPLAY_TO_STATIC: Record<string, string> = {
  'inbox': 'inbox',
  'boîte de réception': 'inbox',
  'sent': 'sentitems',
  'sent items': 'sentitems',
  'éléments envoyés': 'sentitems',
  'trash': 'deleteditems',
  'deleted items': 'deleteditems',
  'éléments supprimés': 'deleteditems',
  'drafts': 'drafts',
  'brouillons': 'drafts',
};

export const STATIC_IDS = new Set(['inbox', 'sentitems', 'deleteditems', 'INBOX', 'SENT', 'TRASH', 'SPAM', 'DRAFT']);

export const WELL_KNOWN_NAMES = new Set([
  'inbox', 'sent', 'sent items', 'deleted items', 'drafts', 'outbox', 'junk email',
  'spam', 'trash', 'boîte de réception', 'éléments envoyés', 'éléments supprimés',
  'courrier indésirable', 'brouillons',
]);

export const THEME_CYCLE: Array<'system' | 'light' | 'dark'> = ['system', 'light', 'dark'];
