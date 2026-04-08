import { Folder, MailFolder } from '../types';
import { Folder as FolderIcon, Inbox, Pencil, Send, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';

interface MailSidebarProps {
  readonly selectedFolder: Folder;
  readonly onSelectFolder: (f: Folder) => void;
  readonly onCompose: () => void;
  readonly accountId: string | null;
  readonly getValidToken: (id: string) => Promise<string | null>;
  readonly onFoldersLoaded?: (folders: MailFolder[]) => void;
}

export function MailSidebar({
  selectedFolder,
  onSelectFolder,
  onCompose,
  accountId,
  getValidToken,
  onFoldersLoaded,
}: MailSidebarProps) {
  const { t } = useTranslation();
  const [dynamicFolders, setDynamicFolders] = useState<MailFolder[]>([]);

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    (async () => {
      const token = await getValidToken(accountId);
      if (!token || cancelled) return;
      try {
        const folders = await invoke<MailFolder[]>('mail_list_folders', {
          accessToken: token,
        });
        // Filter out the 3 distinguished folders already shown in the static section.
        // EWS returns them by display name — filter a known set of well-known names.
        const STATIC_IDS = new Set(['inbox', 'sentitems', 'deleteditems']);
        const WELL_KNOWN_NAMES = new Set([
          'inbox', 'sent items', 'deleted items', 'drafts', 'outbox', 'junk email',
          'spam', 'boîte de réception', 'éléments envoyés', 'éléments supprimés',
          'courrier indésirable', 'brouillons',
        ]);
        const filtered = folders.filter(
          f => !STATIC_IDS.has(f.folder_id) &&
               !WELL_KNOWN_NAMES.has(f.display_name.toLowerCase())
        );
        if (!cancelled) {
          setDynamicFolders(filtered);
          onFoldersLoaded?.(folders);
        }
      } catch (e) {
        console.error('[MailSidebar] list folders error:', e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId, getValidToken]);

  const staticFolders = [
    { id: 'inbox', label: t('mail.inbox', 'Inbox'), Icon: Inbox },
    { id: 'sentitems', label: t('mail.sent', 'Sent'), Icon: Send },
    { id: 'deleteditems', label: t('mail.trash', 'Trash'), Icon: Trash2 },
  ];

  return (
    <nav className="mail-sidebar">
      <button className="mail-compose-btn" onClick={onCompose}>
        <Pencil size={15} />
        {t('mail.compose', 'Nouveau message')}
      </button>

      {staticFolders.map(({ id, label, Icon }) => (
        <button
          key={id}
          className={`mail-folder-btn${selectedFolder === id ? ' active' : ''}`}
          onClick={() => onSelectFolder(id)}
        >
          <Icon size={16} />
          {label}
        </button>
      ))}

      {dynamicFolders.length > 0 && <div className="mail-sidebar-separator" />}

      {dynamicFolders.map(f => (
        <button
          key={f.folder_id}
          className={`mail-folder-btn${selectedFolder === f.folder_id ? ' active' : ''}`}
          onClick={() => onSelectFolder(f.folder_id)}
        >
          <FolderIcon size={16} />
          <span className="mail-folder-btn__name">{f.display_name}</span>
          {f.unread_count > 0 && (
            <span className="mail-folder-btn__badge">{f.unread_count}</span>
          )}
        </button>
      ))}
    </nav>
  );
}
