import { createContext, useContext, useReducer, useEffect, ReactNode } from 'react';
import { CalendarGroup } from '../../../shared/types';

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
  const [groups, dispatch] = useReducer(reducer, [], () => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as CalendarGroup[];
      if (!parsed.find((g) => g.id === 'default')) {
        return [DEFAULT_GROUP, ...parsed];
      }
      return parsed;
    }
    return [DEFAULT_GROUP];
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(groups));
  }, [groups]);

  const addGroup = (name: string) =>
    dispatch({ type: 'ADD', payload: { id: crypto.randomUUID(), name } });

  const removeGroup = (id: string) => {
    if (id === 'default') return;
    dispatch({ type: 'REMOVE', payload: id });
  };

  const updateGroup = (id: string, data: Partial<CalendarGroup>) =>
    dispatch({ type: 'UPDATE', payload: { id, data } });

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
