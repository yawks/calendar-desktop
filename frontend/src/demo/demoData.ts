import { CalendarConfig, CalendarEvent } from '../types';

// Returns a date for the nth day of the current Mon–Sun week (n=1→Mon … n=7→Sun)
function weekDay(n: number, hours: number, minutes = 0): string {
  const today = new Date();
  const day = today.getDay(); // 0=Sun, 1=Mon ...
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const d = new Date(today);
  d.setDate(today.getDate() + mondayOffset + (n - 1));
  d.setHours(hours, minutes, 0, 0);
  return d.toISOString();
}

// Returns a local date string (YYYY-MM-DD) for the nth day of the current week
function weekDate(n: number): string {
  const today = new Date();
  const day = today.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const d = new Date(today);
  d.setDate(today.getDate() + mondayOffset + (n - 1));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const DEMO_CALENDARS: CalendarConfig[] = [
  { id: 'demo-work',     name: 'Work',            url: '', color: '#0f9d58', visible: true, type: 'eventkit' },
  { id: 'demo-personal', name: 'Personal',         url: '', color: '#1a73e8', visible: true, type: 'eventkit' },
  { id: 'demo-family',   name: 'Family',           url: '', color: '#f4511e', visible: true, type: 'eventkit' },
  { id: 'demo-health',   name: 'Health & Fitness', url: '', color: '#8430ce', visible: true, type: 'eventkit' },
  { id: 'demo-holidays', name: 'Public Holidays',  url: '', color: '#d93025', visible: true, type: 'ics'      },
];

let _n = 0;
const id = () => `demo-ev-${_n++}`;

export const DEMO_EVENTS: CalendarEvent[] = [
  // ── All-day ──────────────────────────────────────────────────────────────────
  { id: id(), calendarId: 'demo-work',     title: 'Team Offsite',     start: weekDate(1), end: weekDate(3), isAllday: true,  category: 'allday' },
  { id: id(), calendarId: 'demo-family',   title: "Sarah's Birthday", start: weekDate(4), end: weekDate(5), isAllday: true,  category: 'allday' },

  // ── Monday ───────────────────────────────────────────────────────────────────
  { id: id(), calendarId: 'demo-work',     title: 'Weekly Standup',             start: weekDay(1, 9),     end: weekDay(1, 9, 30),  isAllday: false, category: 'time' },
  { id: id(), calendarId: 'demo-work',     title: 'Product Review',             start: weekDay(1, 14),    end: weekDay(1, 15, 30), isAllday: false, category: 'time', location: 'Conference Room A' },

  // ── Tuesday ──────────────────────────────────────────────────────────────────
  { id: id(), calendarId: 'demo-work',     title: 'Weekly Standup',             start: weekDay(2, 9),     end: weekDay(2, 9, 30),  isAllday: false, category: 'time' },
  { id: id(), calendarId: 'demo-health',   title: 'Doctor Appointment',         start: weekDay(2, 10, 30),end: weekDay(2, 11, 15), isAllday: false, category: 'time', location: 'City Medical Center' },
  { id: id(), calendarId: 'demo-work',     title: '1:1 with Manager',           start: weekDay(2, 16),    end: weekDay(2, 17),     isAllday: false, category: 'time' },

  // ── Wednesday ────────────────────────────────────────────────────────────────
  { id: id(), calendarId: 'demo-work',     title: 'Weekly Standup',             start: weekDay(3, 9),     end: weekDay(3, 9, 30),  isAllday: false, category: 'time' },
  { id: id(), calendarId: 'demo-personal', title: 'Lunch with Alex',            start: weekDay(3, 12),    end: weekDay(3, 13),     isAllday: false, category: 'time', location: 'The Green Bistro' },
  { id: id(), calendarId: 'demo-work',     title: 'Frontend Architecture Sync', start: weekDay(3, 15),    end: weekDay(3, 16, 30), isAllday: false, category: 'time' },

  // ── Thursday ─────────────────────────────────────────────────────────────────
  { id: id(), calendarId: 'demo-work',     title: 'Weekly Standup',             start: weekDay(4, 9),     end: weekDay(4, 9, 30),  isAllday: false, category: 'time' },
  { id: id(), calendarId: 'demo-health',   title: 'Yoga Class',                 start: weekDay(4, 11),    end: weekDay(4, 12),     isAllday: false, category: 'time', location: 'Zen Studio' },
  { id: id(), calendarId: 'demo-family',   title: "Birthday Dinner — Sarah",    start: weekDay(4, 19),    end: weekDay(4, 21),     isAllday: false, category: 'time', location: 'La Piazza Restaurant' },

  // ── Friday ───────────────────────────────────────────────────────────────────
  { id: id(), calendarId: 'demo-work',     title: 'Weekly Standup',             start: weekDay(5, 9),     end: weekDay(5, 9, 30),  isAllday: false, category: 'time' },
  { id: id(), calendarId: 'demo-work',     title: 'Sprint Retrospective',       start: weekDay(5, 14),    end: weekDay(5, 16),     isAllday: false, category: 'time' },
  { id: id(), calendarId: 'demo-personal', title: 'Evening Run',                start: weekDay(5, 18),    end: weekDay(5, 19),     isAllday: false, category: 'time' },

  // ── Weekend ──────────────────────────────────────────────────────────────────
  { id: id(), calendarId: 'demo-personal', title: 'Hiking Trip',                start: weekDay(6, 9),     end: weekDay(6, 12),     isAllday: false, category: 'time', location: 'Forest Trail Park' },
  { id: id(), calendarId: 'demo-family',   title: 'Family Brunch',              start: weekDay(7, 11),    end: weekDay(7, 13),     isAllday: false, category: 'time', location: "Grandma's House" },
];
