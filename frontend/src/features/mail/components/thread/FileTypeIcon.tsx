import { FileIcon, defaultStyles } from 'react-file-icon';

export function FileTypeIcon({ name, size = 20 }: { readonly name: string; readonly size?: number }) {
  const ext = (name.split('.').pop() ?? '').toLowerCase();
  return (
    <div style={{ width: size, height: size, flexShrink: 0 }}>
      <FileIcon extension={ext} {...(defaultStyles[ext as keyof typeof defaultStyles] ?? {})} />
    </div>
  );
}
