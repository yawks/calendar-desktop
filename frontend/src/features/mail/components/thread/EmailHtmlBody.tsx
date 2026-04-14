import { useEffect, useRef } from 'react';

export function EmailHtmlBody({ html, onImageClick }: { readonly html: string; readonly onImageClick?: (src: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const imgs = ref.current.querySelectorAll('img');
    const handlers: (() => void)[] = [];
    imgs.forEach(img => {
      const h = () => onImageClick?.(img.src);
      img.addEventListener('click', h);
      img.style.cursor = 'zoom-in';
      handlers.push(() => img.removeEventListener('click', h));
    });
    return () => handlers.forEach(h => h());
  }, [html, onImageClick]);

  return (
    <div
      ref={ref}
      className="mail-message__body"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
