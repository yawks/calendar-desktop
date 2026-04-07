import { useState, useCallback } from 'react';

const KEY = 'calendar-desktop-default-cal';

export function getDefaultCalendarId(): string | null {
  return localStorage.getItem(KEY);
}

export function useDefaultCalendar() {
  const [defaultCalendarId, setLocalDefault] = useState<string | null>(() => localStorage.getItem(KEY));

  const setDefaultCalendar = useCallback((id: string) => {
    localStorage.setItem(KEY, id);
    setLocalDefault(id);
  }, []);

  return { defaultCalendarId, setDefaultCalendar };
}
