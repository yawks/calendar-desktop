import { ChevronRight, Folder as FolderIcon, Inbox, Search, Send, Trash2 } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { MailFolder } from '../types';

interface FolderNode {
  folder: MailFolder;
  label: string;
  children: FolderNode[];
  isVirtual: boolean;
}

const SYSTEM_FOLDER_MAP: Record<string, { labelKey: string; Icon: React.FC<{ size?: number }> }> = {
  inbox:        { labelKey: 'mail.folders.inbox', Icon: Inbox as any },
  INBOX:        { labelKey: 'mail.folders.inbox', Icon: Inbox as any },
  sentitems:    { labelKey: 'mail.folders.sent', Icon: Send as any },
  SENT:         { labelKey: 'mail.folders.sent', Icon: Send as any },
  deleteditems: { labelKey: 'mail.folders.trash', Icon: Trash2 as any },
  TRASH:        { labelKey: 'mail.folders.trash', Icon: Trash2 as any },
};

function collectAllNames(folders: MailFolder[]): Set<string> {
  const names = new Set<string>();
  for (const f of folders) {
    const parts = f.display_name.split('/');
    for (let i = 1; i <= parts.length; i++) names.add(parts.slice(0, i).join('/'));
  }
  return names;
}

function makeNode(name: string, real: MailFolder | undefined): FolderNode {
  const parts = name.split('/');
  const label = parts[parts.length - 1] ?? name;
  if (real) return { folder: real, label, children: [], isVirtual: false };
  return {
    folder: { folder_id: `__v__:${name}`, display_name: name, total_count: 0, unread_count: 0 },
    label, children: [], isVirtual: true,
  };
}

function sortTree(nodes: FolderNode[]): void {
  const systemOrder = ['inbox', 'drafts', 'scheduled', 'sent', 'trash', 'snoozed', 'spam'];
  const aliases: Record<string, string> = {
    inbox: 'inbox', drafts: 'drafts', draft: 'drafts', scheduled: 'scheduled',
    sent: 'sent', sentitems: 'sent', trash: 'trash', deleteditems: 'trash',
    snoozed: 'snoozed', spam: 'spam', junk: 'spam', junkemail: 'spam',
  };
  const rank = (node: FolderNode) => {
    const id = node.folder.folder_id.toLowerCase();
    const label = node.label.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const role = aliases[id] ?? aliases[label];
    const index = role ? systemOrder.indexOf(role) : -1;
    return index === -1 ? systemOrder.length : index;
  };
  nodes.sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label));
  for (const n of nodes) sortTree(n.children);
}

function buildTree(folders: MailFolder[]): FolderNode[] {
  if (!folders?.length) return [];

  const byName = new Map(folders.map(f => [f.display_name, f]));
  const nodeMap = new Map<string, FolderNode>();
  for (const name of collectAllNames(folders)) {
    nodeMap.set(name, makeNode(name, byName.get(name)));
  }

  const roots: FolderNode[] = [];
  for (const [name, node] of nodeMap) {
    const slashIdx = name.lastIndexOf('/');
    if (slashIdx === -1) { roots.push(node); continue; }
    const parent = nodeMap.get(name.slice(0, slashIdx));
    if (parent) { if (!parent.children.includes(node)) parent.children.push(node); }
    else roots.push(node);
  }

  sortTree(roots);
  return roots;
}

function matchesSearch(node: FolderNode, q: string): boolean {
  if (node.label.toLowerCase().includes(q)) return true;
  return node.children.some(c => matchesSearch(c, q));
}

function FolderItem({
  node, depth, onSelect, expandedIds, onToggle, currentFolderId, searchQuery,
}: {
  readonly node: FolderNode;
  readonly depth: number;
  readonly onSelect: (id: string) => void;
  readonly expandedIds: Set<string>;
  readonly onToggle: (id: string) => void;
  readonly currentFolderId?: string;
  readonly searchQuery: string;
}) {
  const { t } = useTranslation();
  const { folder, label, children, isVirtual } = node;
  const hasChildren = children.length > 0;
  const isExpanded = expandedIds.has(folder.folder_id);
  const isCurrent = folder.folder_id === currentFolderId;
  const sys = SYSTEM_FOLDER_MAP[folder.folder_id];

  const visible = searchQuery
    ? children.filter(c => matchesSearch(c, searchQuery))
    : isExpanded ? children : [];

  return (
    <>
      <div
        className={`folder-picker__item${isCurrent ? ' folder-picker__item--current' : ''}`}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
      >
        <button
          className="folder-picker__main"
          onClick={() => {
            if (isVirtual) onToggle(folder.folder_id);
            else onSelect(folder.folder_id);
          }}
          disabled={isCurrent}
        >
          {sys ? <sys.Icon size={14} /> : <FolderIcon size={14} />}
          <span className="folder-picker__label">{sys ? t(sys.labelKey) : label}</span>
        </button>
        {hasChildren && (
          <button
            className="folder-picker__chevron"
            onClick={() => onToggle(folder.folder_id)}
            tabIndex={-1}
            aria-label={t(isExpanded ? 'mail.folders.collapse' : 'mail.folders.expand')}
          >
            <ChevronRight
              size={12}
              style={{ transform: (isExpanded || searchQuery) ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}
            />
          </button>
        )}
      </div>
      {(searchQuery ? true : isExpanded) && visible.map(child => (
        <FolderItem
          key={child.folder.folder_id}
          node={child}
          depth={depth + 1}
          onSelect={onSelect}
          expandedIds={expandedIds}
          onToggle={onToggle}
          currentFolderId={currentFolderId}
          searchQuery={searchQuery}
        />
      ))}
    </>
  );
}

interface FolderPickerPopoverProps {
  readonly folders: MailFolder[];
  readonly onSelect: (folderId: string) => void;
  readonly onClose: () => void;
  readonly currentFolderId?: string;
  readonly sources?: ReadonlyArray<{ accountId: string; label: string; color?: string; folders: MailFolder[]; canImport: boolean; canExport: boolean }>;
  readonly currentAccountId?: string;
  readonly onSelectDestination?: (accountId: string, folderId: string, operation: 'copy' | 'move') => void;
}

export function FolderPickerPopover({ folders, onSelect, onClose, currentFolderId, sources, currentAccountId, onSelectDestination }: FolderPickerPopoverProps) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<{ accountId: string; folderId: string; label: string } | null>(null);
  const [operation, setOperation] = useState<'copy' | 'move'>('copy');
  const inputRef = useRef<HTMLInputElement>(null);
  const q = search.trim().toLowerCase();

  useEffect(() => { inputRef.current?.focus(); }, []);

  const tree = buildTree(folders ?? []);
  const visible = q ? tree.filter(n => matchesSearch(n, q)) : tree;
  const orderedSources = sources ? [...sources].sort((a, b) => {
    if (a.accountId === currentAccountId) return -1;
    if (b.accountId === currentAccountId) return 1;
    return 0;
  }) : undefined;

  const selectDestination = (accountId: string, folder: MailFolder) => {
    if (!onSelectDestination) return onSelect(folder.folder_id);
    if (accountId === currentAccountId) return onSelectDestination(accountId, folder.folder_id, 'move');
    setPending({ accountId, folderId: folder.folder_id, label: folder.display_name });
  };

  const handleToggle = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <div className="folder-picker">
      <div className="folder-picker__search">
        <Search size={13} className="folder-picker__search-icon" />
        <input
          ref={inputRef}
          className="folder-picker__search-input"
          placeholder={t('mail.folders.search')}
          value={search}
          onChange={e => setSearch(e.target.value)}
          onKeyDown={e => { if (e.key === 'Escape') onClose(); }}
        />
      </div>
      {pending ? <div className="folder-picker__transfer-confirm">
        <button className="folder-picker__back" type="button" onClick={() => setPending(null)}>← {t('common.back', 'Retour')}</button>
        <strong>{t('mail.transfer.toFolder', 'Vers « {{folder}} »', { folder: pending.label })}</strong>
        <label className="folder-picker__operation"><input type="radio" checked={operation === 'copy'} onChange={() => setOperation('copy')} /><span><b>{t('mail.transfer.copy', 'Copier')}</b><small>{t('mail.transfer.copyHint', 'Conserver la conversation dans la source actuelle')}</small></span></label>
        <label className="folder-picker__operation"><input type="radio" checked={operation === 'move'} onChange={() => setOperation('move')} /><span><b>{t('mail.transfer.move', 'Déplacer')}</b><small>{t('mail.transfer.moveHint', 'Supprimer l’original après une copie réussie')}</small></span></label>
        <button className="folder-picker__confirm" type="button" onClick={() => onSelectDestination?.(pending.accountId, pending.folderId, operation)}>{operation === 'copy' ? t('mail.transfer.copy', 'Copier') : t('mail.transfer.move', 'Déplacer')}</button>
      </div> : <div className="folder-picker__list">
        {orderedSources ? orderedSources.map(source => {
          const nodes = buildTree(source.folders);
          const shown = q ? nodes.filter(node => matchesSearch(node, q)) : nodes;
          if (!shown.length) return null;
          const currentSourceCanExport = orderedSources.find(item => item.accountId === currentAccountId)?.canExport ?? false;
          const unavailable = source.accountId !== currentAccountId && (!source.canImport || !currentSourceCanExport);
          return <div className="folder-picker__source" key={source.accountId}>
            <div className="folder-picker__source-label"><i style={{ background: source.color }} />{source.label}</div>
            {unavailable ? <div className="folder-picker__source-unavailable">{t('mail.transfer.unsupported', 'Transfert non pris en charge')}</div> : shown.map(node => <FolderItem
              key={`${source.accountId}:${node.folder.folder_id}`} node={node} depth={0}
              onSelect={folderId => { const folder = source.folders.find(item => item.folder_id === folderId); if (folder) selectDestination(source.accountId, folder); }}
              expandedIds={expandedIds} onToggle={handleToggle}
              currentFolderId={source.accountId === currentAccountId ? currentFolderId : undefined} searchQuery={q}
            />)}
          </div>;
        }) : visible.length === 0 ? (
          <div className="folder-picker__empty">{t('mail.folders.empty')}</div>
        ) : visible.map(node => (
          <FolderItem
            key={node.folder.folder_id}
            node={node}
            depth={0}
            onSelect={onSelect}
            expandedIds={expandedIds}
            onToggle={handleToggle}
            currentFolderId={currentFolderId}
            searchQuery={q}
          />
        ))}
      </div>}
    </div>
  );
}
