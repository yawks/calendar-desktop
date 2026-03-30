import { createContext, useContext, useReducer, useEffect, ReactNode } from 'react';
import { CalendarConfig } from '../types';

const STORAGE_KEY = 'calendar-desktop-calendars';

type Action =
  | { type: 'ADD'; payload: CalendarConfig }
  | { type: 'REMOVE'; payload: string }
  | { type: 'TOGGLE'; payload: string }
  | { type: 'UPDATE'; payload: { id: string; data: Partial<CalendarConfig> } }
  | { type: 'REORDER'; payload: CalendarConfig[] };

function reducer(state: CalendarConfig[], action: Action): CalendarConfig[] {
  switch (action.type) {
    case 'ADD':
      return [...state, action.payload];
    case 'REMOVE':
      return state.filter((c) => c.id !== action.payload);
    case 'TOGGLE':
      return state.map((c) =>
        c.id === action.payload ? { ...c, visible: !c.visible } : c
      );
    case 'UPDATE':
      return state.map((c) =>
        c.id === action.payload.id ? { ...c, ...action.payload.data } : c
      );
    case 'REORDER':
      return action.payload;
  }
}

interface CalendarContextValue {
  calendars: CalendarConfig[];
  addCalendar: (cal: Omit<CalendarConfig, 'id'>) => void;
  removeCalendar: (id: string) => void;
  toggleCalendar: (id: string) => void;
  updateCalendar: (id: string, data: Partial<CalendarConfig>) => void;
  reorderCalendars: (calendars: CalendarConfig[]) => void;
}

const CalendarContext = createContext<CalendarContextValue | null>(null);

export function CalendarProvider({ children }: { children: ReactNode }) {
  const [calendars, dispatch] = useReducer(reducer, [], () => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? (JSON.parse(stored) as CalendarConfig[]) : [];
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(calendars));
  }, [calendars]);

  const addCalendar = (cal: Omit<CalendarConfig, 'id'>) =>
    dispatch({ type: 'ADD', payload: { ...cal, id: crypto.randomUUID() } });

  const removeCalendar = (id: string) => dispatch({ type: 'REMOVE', payload: id });

  const toggleCalendar = (id: string) => dispatch({ type: 'TOGGLE', payload: id });

  const updateCalendar = (id: string, data: Partial<CalendarConfig>) =>
    dispatch({ type: 'UPDATE', payload: { id, data } });

  const reorderCalendars = (newCalendars: CalendarConfig[]) =>
    dispatch({ type: 'REORDER', payload: newCalendars });

  return (
    <CalendarContext.Provider
      value={{ calendars, addCalendar, removeCalendar, toggleCalendar, updateCalendar, reorderCalendars }}
    >
      {children}
    </CalendarContext.Provider>
  );
}

export function useCalendars() {
  const ctx = useContext(CalendarContext);
  if (!ctx) throw new Error('useCalendars must be used within CalendarProvider');
  return ctx;
}
