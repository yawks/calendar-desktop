import React from 'react';

export function EmailHtmlBody({ html }: { readonly html: string }) {
  const iframeRef = React.useRef<HTMLIFrameElement>(null);

  React.useEffect(() => {
    if (iframeRef.current) {
      const doc = iframeRef.current.contentDocument;
      if (doc) {
        doc.open();
        const baseStyle = `
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
              font-size: 14px;
              line-height: 1.5;
              color: inherit;
              margin: 0;
              padding: 16px;
            }
            img { max-width: 100%; height: auto; }
            pre { white-space: pre-wrap; word-break: break-all; }
            a { color: #1a73e8; }
          </style>
        `;
        doc.write(baseStyle + html);
        doc.close();

        const resize = () => {
          if (iframeRef.current && doc.body) {
            iframeRef.current.style.height = doc.body.scrollHeight + 'px';
          }
        };
        resize();
        iframeRef.current.onload = resize;
      }
    }
  }, [html]);

  return (
    <div className="mail-email-body">
      <iframe
        ref={iframeRef}
        title="Email content"
        style={{ width: '100%', border: 'none', display: 'block' }}
        sandbox="allow-popups allow-popups-to-escape-sandbox"
      />
    </div>
  );
}
