import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import { CalendarDays, Mail } from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

interface Props {
  // 'calendar' = ce bouton ouvre la fenêtre Calendrier (fenêtre courante = Mail)
  // 'mail'     = ce bouton ouvre la fenêtre Mail     (fenêtre courante = Calendrier)
  readonly target: 'mail' | 'calendar';
}

// Génère une icône PNG 64×64 (enveloppe ou grille calendrier) en bytes bruts.
async function makeWindowIcon(type: 'mail' | 'calendar'): Promise<Uint8Array> {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const bg = type === 'mail' ? '#3B82F6' : '#10B981';
  const r = 14;
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.arcTo(size, 0, size, size, r);
  ctx.arcTo(size, size, 0, size, r);
  ctx.arcTo(0, size, 0, 0, r);
  ctx.arcTo(0, 0, size, 0, r);
  ctx.closePath();
  ctx.fill();

  const mailSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><polyline points="2,4 12,13 22,4"/></svg>`;
  const calSvg  = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><rect x="7" y="14" width="3" height="3" rx="0.5" fill="white" stroke="none"/><rect x="14" y="14" width="3" height="3" rx="0.5" fill="white" stroke="none"/></svg>`;

  const svg = type === 'mail' ? mailSvg : calSvg;
  const img = new Image();
  img.src = 'data:image/svg+xml,' + encodeURIComponent(svg);
  await new Promise<void>((res) => { img.onload = () => res(); });
  ctx.drawImage(img, 10, 10, 44, 44);

  const dataUrl = canvas.toDataURL('image/png');
  const base64 = dataUrl.split(',')[1];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function openOrFocusWindow(
  label: string,
  url: string,
  title: string,
  iconType: 'mail' | 'calendar',
) {
  try {
    // Tente d'abord de remettre la fenêtre existante au premier plan.
    await invoke('focus_window', { label });
  } catch {
    // La fenêtre n'existe pas (jamais ouverte, ou fermée) → on la crée.
    const icon = await makeWindowIcon(iconType);
    const _w = new WebviewWindow(label, {
      url,
      title,
      width: 1280,
      height: 800,
      minWidth: 800,
      minHeight: 600,
    });
    _w.once('tauri://created', () => { _w.setIcon(icon).catch(() => {}); });
  }
}

export default function WindowSwitcher({ target }: Props) {
  const { t } = useTranslation();

  // Applique l'icône adaptée à la fenêtre courante au montage.
  // target='calendar' → fenêtre courante = Mail → icône bleue enveloppe
  // target='mail'     → fenêtre courante = Calendrier → icône verte calendrier
  useEffect(() => {
    const currentType = target === 'calendar' ? 'mail' : 'calendar';
    makeWindowIcon(currentType).then((bytes) => {
      getCurrentWindow().setIcon(bytes).catch(() => {});
    });
  }, [target]);

  const handleClick = async () => {
    if (target === 'calendar') {
      await openOrFocusWindow(
        'calendar',
        globalThis.location.origin + '/calendar',
        t('tabs.calendar', 'Calendrier'),
        'calendar',
      );
    } else {
      await openOrFocusWindow(
        'main',
        globalThis.location.origin + '/',
        t('tabs.mail', 'Mail'),
        'mail',
      );
    }
  };

  return (
    <div className="app-tabs">
      <button className="app-tab" onClick={handleClick}>
        {target === 'calendar' ? (
          <>
            <CalendarDays size={16} />
            {t('tabs.calendar', 'Calendrier')}
          </>
        ) : (
          <>
            <Mail size={16} />
            {t('tabs.mail', 'Mail')}
          </>
        )}
      </button>
    </div>
  );
}
