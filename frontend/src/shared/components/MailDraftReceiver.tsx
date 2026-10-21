import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLayout } from '../store/LayoutStore';
import { receiveMailDrafts } from '../services/mailDraftWindow';

export default function MailDraftReceiver() {
  const navigate = useNavigate();
  const { setActiveTab } = useLayout();
  useEffect(() => {
    const url = new URL(globalThis.location.href);
    if (url.pathname === '/calendar' || url.searchParams.get('window') === 'calendar') return;
    // Reuse the original browser mail window when the calendar opens separately.
    if (!window.name) window.name = 'courrier-main';
    return receiveMailDrafts(draft => {
      setActiveTab('mail');
      navigate('/mail', { state: { eventDraft: draft } });
    });
  }, [navigate, setActiveTab]);
  return null;
}
