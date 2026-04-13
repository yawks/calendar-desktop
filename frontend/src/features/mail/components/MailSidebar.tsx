import { ChevronRight, FileText, Folder as FolderIcon, Inbox, Pencil, Send, Trash2 } from 'lucide-react';
import { Folder, MailFolder } from '../types';
import { useEffect, useState } from 'react';

import type { MailProvider } from '../providers/MailProvider';
import { useTranslation } from 'react-i18next';

type DynamicFolderEntry = MailFolder & { accountId?: string; accountColor?: string };

interface FolderNode {
  entry: DynamicFolderEntry;
  label: string;
  children: FolderNode[];
  isVirtual: boolean;
}

interface MailSidebarProps {
  readonly selectedFolder: Folder;
  readonly onSelectFolder: (f: Folder) => void;
  readonly onCompose: () => void;
  readonly provider: MailProvider | null;
  readonly onFoldersLoaded?: (folders: MailFolder[]) => void;
  readonly folderUnreadCounts?: Record<string, number>;
  /** In All-accounts mode, replaces the provider-loaded dynamic folders. */
  readonly overrideDynamicFolders?: DynamicFolderEntry[];
}

const STATIC_IDS = new Set(['inbox', 'sentitems', 'deleteditems', 'INBOX', 'SENT', 'TRASH', 'SPAM', 'DRAFT']);
const WELL_KNOWN_NAMES = new Set([
  'inbox', 'sent', 'sent items', 'deleted items', 'drafts', 'outbox', 'junk email',
  'spam', 'trash', 'boîte de réception', 'éléments envoyés', 'éléments supprimés',
  'courrier indésirable', 'brouillons',
]);

function buildFolderTree(folders: DynamicFolderEntry[]): FolderNode[] {
  //console.log('[MailSidebar] buildFolderTree input:', folders.map(f => `${f.display_name} (${f.folder_id})`));

  // Pass 1 – collect all names that need a node (real + implied parents)
  const allNames = new Set<string>();
  for (const f of folders) {
    const parts = f.display_name.split('/');
    for (let i = 1; i <= parts.length; i++) {
      allNames.add(parts.slice(0, i).join('/'));
    }
  }

  // Pass 2 – create one node per name
  // For names that match a real folder, use the real entry; otherwise create a virtual one.
  // When multiple accounts share the same display_name, group them under the same key but keep
  // each account's entry as a separate child so nothing is lost.
  const nodeMap = new Map<string, FolderNode>();

  for (const name of allNames) {
    const realFolders = folders.filter(f => f.display_name === name);
    if (realFolders.length === 1) {
      // Single entry: normal real node
      const f = realFolders[0];
      const parts = name.split('/');
      nodeMap.set(name, { entry: f, label: parts[parts.length - 1], children: [], isVirtual: false });
    } else if (realFolders.length > 1) {
      // Multiple accounts share this name: create a virtual parent and add each as a child
      const parts = name.split('/');
      const virtualEntry: DynamicFolderEntry = {
        folder_id: `__virtual__:${name}`,
        display_name: name,
        total_count: 0,
        unread_count: 0,
      };
      const parentNode: FolderNode = { entry: virtualEntry, label: parts[parts.length - 1], children: [], isVirtual: true };
      for (const f of realFolders) {
        parentNode.children.push({ entry: f, label: f.accountId ?? name, children: [], isVirtual: false });
      }
      nodeMap.set(name, parentNode);
    } else {
      // Implied parent – virtual node
      const parts = name.split('/');
      const virtualEntry: DynamicFolderEntry = {
        folder_id: `__virtual__:${name}`,
        display_name: name,
        total_count: 0,
        unread_count: 0,
      };
      nodeMap.set(name, { entry: virtualEntry, label: parts[parts.length - 1], children: [], isVirtual: true });
    }
  }

  // Pass 3 – link children to parents and collect roots
  const roots: FolderNode[] = [];
  for (const [name, node] of nodeMap) {
    const parts = name.split('/');
    if (parts.length === 1) {
      roots.push(node);
    } else {
      const parentName = parts.slice(0, -1).join('/');
      const parent = nodeMap.get(parentName);
      if (parent && !parent.children.includes(node)) {
        parent.children.push(node);
      } else if (!parent) {
        console.warn('[MailSidebar] no parent found for', name, '– adding to root');
        roots.push(node);
      }
    }
  }

  roots.sort((a, b) => a.entry.display_name.localeCompare(b.entry.display_name));
  function sortChildren(nodes: FolderNode[]) {
    nodes.sort((a, b) => a.label.localeCompare(b.label));
    for (const n of nodes) sortChildren(n.children);
  }
  sortChildren(roots);

  //console.log('[MailSidebar] buildFolderTree roots:', roots.map(r => `${r.entry.display_name} (${r.children.length} children)`));
  return roots;
}

function FolderTreeNode({
  node,
  depth,
  selectedFolder,
  onSelectFolder,
  folderUnreadCounts,
  expandedFolders,
  onToggleExpand,
}: {
  readonly node: FolderNode;
  readonly depth: number;
  readonly selectedFolder: Folder;
  readonly onSelectFolder: (f: Folder) => void;
  readonly folderUnreadCounts: Record<string, number>;
  readonly expandedFolders: Set<string>;
  readonly onToggleExpand: (id: string) => void;
}) {
  const { entry, label, children, isVirtual } = node;
  const hasChildren = children.length > 0;
  const isExpanded = expandedFolders.has(entry.folder_id);
  const isActive = selectedFolder === entry.folder_id && !isVirtual;
  const unread = folderUnreadCounts[entry.folder_id] ?? entry.unread_count;

  const handleMainClick = () => {
    if (isVirtual) {
      onToggleExpand(entry.folder_id);
    } else {
      onSelectFolder(entry.folder_id);
    }
  };

  return (
    <>
      <div
        className={`mail-folder-row${isActive ? ' active' : ''}`}
        style={{ paddingLeft: `${depth * 14}px` }}
      >
        <button className="mail-folder-main" onClick={handleMainClick}>
          <FolderIcon size={16} style={entry.accountColor ? { color: entry.accountColor } : undefined} />
          <span className="mail-folder-btn__name">{label}</span>
          {unread > 0 && <span className="mail-folder-btn__badge">{unread}</span>}
        </button>
        {hasChildren && (
          <button
            className="mail-folder-chevron"
            onClick={() => onToggleExpand(entry.folder_id)}
            tabIndex={-1}
            aria-label={isExpanded ? 'Collapse' : 'Expand'}
          >
            <ChevronRight
              size={13}
              style={{ transform: isExpanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}
            />
          </button>
        )}
      </div>

      {hasChildren && isExpanded && children.map(child => (
        <FolderTreeNode
          key={`${child.entry.accountId ?? ''}:${child.entry.folder_id}`}
          node={child}
          depth={depth + 1}
          selectedFolder={selectedFolder}
          onSelectFolder={onSelectFolder}
          folderUnreadCounts={folderUnreadCounts}
          expandedFolders={expandedFolders}
          onToggleExpand={onToggleExpand}
        />
      ))}
    </>
  );
}

export function MailSidebar({
  selectedFolder,
  onSelectFolder,
  onCompose,
  provider,
  onFoldersLoaded,
  folderUnreadCounts = {},
  overrideDynamicFolders,
}: MailSidebarProps) {
  const { t } = useTranslation();
  const [dynamicFolders, setDynamicFolders] = useState<DynamicFolderEntry[]>([]);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!provider) { setDynamicFolders([]); return; }
    let cancelled = false;
    (async () => {
      try {
        const folders = await provider.listFolders();
        if (cancelled) return;
        const filtered = folders.filter(
          f => !STATIC_IDS.has(f.folder_id) &&
               !WELL_KNOWN_NAMES.has(f.display_name.toLowerCase())
        );
        console.log('[MailSidebar] provider.listFolders() total:', folders.length, '/ after filter:', filtered.length);
        console.log('[MailSidebar] filtered folders:', filtered.map(f => f.display_name));
        setDynamicFolders(filtered);
        onFoldersLoaded?.(folders);
      } catch (e) {
        console.error('[MailSidebar] list folders error:', e);
      }
    })();
    return () => { cancelled = true; };
  // provider.accountId is the stable identity
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider?.accountId, onFoldersLoaded]);

  const displayedDynamic = overrideDynamicFolders ?? dynamicFolders;
  const folderTree = buildFolderTree(displayedDynamic);

  const handleToggleExpand = (id: string) => {
    setExpandedFolders(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const staticFolders = [
    { id: 'inbox', label: t('mail.inbox', 'Inbox'), Icon: Inbox },
    { id: 'drafts', label: t('mail.drafts', 'Drafts'), Icon: FileText },
    { id: 'sentitems', label: t('mail.sent', 'Sent'), Icon: Send },
    { id: 'deleteditems', label: t('mail.trash', 'Trash'), Icon: Trash2 },
  ];

  return (
    <nav className="mail-sidebar">
      <button className="mail-compose-btn" onClick={onCompose}>
        <Pencil size={15} />
        {t('mail.compose', 'Nouveau message')}
      </button>

      {staticFolders.map(({ id, label, Icon }) => {
        const unread = folderUnreadCounts[id] ?? 0;
        return (
          <button
            key={id}
            className={`mail-folder-btn${selectedFolder === id ? ' active' : ''}`}
            onClick={() => onSelectFolder(id)}
          >
            <Icon size={16} />
            {label}
            {unread > 0 && <span className="mail-folder-btn__badge">{unread}</span>}
          </button>
        );
      })}

      {folderTree.length > 0 && <div className="mail-sidebar-separator" />}

      {folderTree.map(node => (
        <FolderTreeNode
          key={`${node.entry.accountId ?? ''}:${node.entry.folder_id}`}
          node={node}
          depth={0}
          selectedFolder={selectedFolder}
          onSelectFolder={onSelectFolder}
          folderUnreadCounts={folderUnreadCounts}
          expandedFolders={expandedFolders}
          onToggleExpand={handleToggleExpand}
        />
      ))}
    </nav>
  );
}
