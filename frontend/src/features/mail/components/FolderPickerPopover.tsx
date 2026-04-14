import { ChevronRight, Folder as FolderIcon, Inbox, Search, Send, Trash2 } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';

import type { MailFolder } from '../types';

interface FolderNode {
  folder: MailFolder;
  label: string;
  children: FolderNode[];
  isVirtual: boolean;
}

const SYSTEM_FOLDER_MAP: Record<string, { label: string; Icon: React.FC<{ size?: number }> }> = {
  inbox:        { label: 'Inbox',   Icon: Inbox as any },
  INBOX:        { label: 'Inbox',   Icon: Inbox as any },
  sentitems:    { label: 'Sent',    Icon: Send as any },
  SENT:         { label: 'Sent',    Icon: Send as any },
  deleteditems: { label: 'Trash',   Icon: Trash2 as any },
  TRASH:        { label: 'Trash',   Icon: Trash2 as any },
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
  nodes.sort((a, b) => a.label.localeCompare(b.label));
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
          <span className="folder-picker__label">{sys ? sys.label : label}</span>
        </button>
        {hasChildren && (
          <button
            className="folder-picker__chevron"
            onClick={() => onToggle(folder.folder_id)}
            tabIndex={-1}
            aria-label={isExpanded ? 'Collapse' : 'Expand'}
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
}

export function FolderPickerPopover({ folders, onSelect, onClose, currentFolderId }: FolderPickerPopoverProps) {
  const [search, setSearch] = useState('');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);
  const q = search.trim().toLowerCase();

  useEffect(() => { inputRef.current?.focus(); }, []);

  const tree = buildTree(folders ?? []);
  const visible = q ? tree.filter(n => matchesSearch(n, q)) : tree;

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
          placeholder="Rechercher…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          onKeyDown={e => { if (e.key === 'Escape') onClose(); }}
        />
      </div>
      <div className="folder-picker__list">
        {visible.length === 0 ? (
          <div className="folder-picker__empty">Aucun dossier</div>
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
      </div>
    </div>
  );
}
