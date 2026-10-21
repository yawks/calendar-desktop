import { createContext, useContext, useReducer, useEffect, ReactNode } from 'react';
import { useVault } from '../../../shared/security/VaultProvider';
import { CalendarGroup } from '../../../shared/types';

import { OTHER_CALENDARS_GROUP } from '../utils/sharedCalendars';

const STORAGE_KEY = 'calendar-desktop-groups';

const DEFAULT_GROUP: CalendarGroup = { id: 'default', name: 'My calendars' };

type Action =
  | { type: 'ADD'; payload: CalendarGroup }
  | { type: 'REMOVE'; payload: string }
  | { type: 'UPDATE'; payload: { id: string; data: Partial<CalendarGroup> } };

function reducer(state: CalendarGroup[], action: Action): CalendarGroup[] {
  switch (action.type) {
    case 'ADD':
      return [...state, action.payload];
    case 'REMOVE':
      return state.filter((g) => g.id !== action.payload);
    case 'UPDATE':
      return state.map((g) =>
        g.id === action.payload.id ? { ...g, ...action.payload.data } : g
      );
  }
}

interface CalendarGroupContextValue {
  groups: CalendarGroup[];
  addGroup: (name: string) => void;
  removeGroup: (id: string) => void;
  updateGroup: (id: string, data: Partial<CalendarGroup>) => void;
}

const CalendarGroupContext = createContext<CalendarGroupContextValue | null>(null);

export function CalendarGroupProvider({ children }: { children: ReactNode }) {
  const vault = useVault();
  const [storedGroups, dispatch] = useReducer(reducer, [], () => {
    const saved = vault.read<CalendarGroup[] | null>(STORAGE_KEY, null);
    const stored = saved === null ? localStorage.getItem(STORAGE_KEY) : null;
    const parsed = saved ?? (stored ? JSON.parse(stored) as CalendarGroup[] : []);
    return parsed.some((group) => group.id === 'default') ? parsed : [DEFAULT_GROUP, ...parsed];
  });

  const groups = storedGroups.some(group => group.id === OTHER_CALENDARS_GROUP) ? storedGroups : [...storedGroups, { id: OTHER_CALENDARS_GROUP, name: 'Other calendars' }];

  useEffect(() => {
    vault.write(STORAGE_KEY, storedGroups);
    localStorage.removeItem(STORAGE_KEY);
  }, [storedGroups]);

  const addGroup = (name: string) =>
    dispatch({ type: 'ADD', payload: { id: crypto.randomUUID(), name } });

  const removeGroup = (id: string) => {
    if (id === 'default' || id === OTHER_CALENDARS_GROUP) return;
    dispatch({ type: 'REMOVE', payload: id });
  };

  const updateGroup = (id: string, data: Partial<CalendarGroup>) => {
    if (id === OTHER_CALENDARS_GROUP && !storedGroups.some(group => group.id === id)) {
      dispatch({ type: 'ADD', payload: { id, name: 'Other calendars', collapsed: data.collapsed } });
    } else dispatch({ type: 'UPDATE', payload: { id, data } });
  };

  return (
    <CalendarGroupContext.Provider value={{ groups, addGroup, removeGroup, updateGroup }}>
      {children}
    </CalendarGroupContext.Provider>
  );
}

export function useCalendarGroups() {
  const ctx = useContext(CalendarGroupContext);
  if (!ctx) throw new Error('useCalendarGroups must be used within CalendarGroupProvider');
  return ctx;
}
