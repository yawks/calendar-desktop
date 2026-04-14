// TUI Calendar light theme (Google Calendar inspired)
export const LIGHT_THEME = {
  common: {
    backgroundColor: '#ffffff',
    border: '1px solid #dadce0',
    holiday: { color: '#d93025' },
    saturday: { color: '#1a73e8' },
    today: { color: '#ffffff', backgroundColor: '#1a73e8' },
    gridSelection: { backgroundColor: 'rgba(26,115,232,0.06)', border: '1px solid #1a73e8' },
  },
  week: {
    dayName: {
      borderLeft: 'none',
      borderTop: 'none',
      borderBottom: '1px solid #dadce0',
      backgroundColor: '#ffffff',
    },
    dayGrid: { borderRight: '1px solid #dadce0', backgroundColor: '' },
    dayGridLeft: { borderRight: '1px solid #dadce0', backgroundColor: '#ffffff', width: '72px' },
    timeGrid: { borderRight: '1px solid #dadce0' },
    timeGridLeft: { backgroundColor: '#ffffff', borderRight: '1px solid #dadce0', width: '72px' },
    timeGridHourLine: { borderBottom: '1px solid #dadce0' },
    timeGridHalfHourLine: { borderBottom: 'none' },
    weekend: { backgroundColor: '#fafafa' },
    today: { color: '#202124', backgroundColor: 'rgba(26,115,232,0.05)' },
    pastDay: { color: '#9aa0a6' },
    pastTime: { color: '#9aa0a6' },
    gridSelection: { backgroundColor: 'rgba(26,115,232,0.06)', border: '1px solid #1a73e8' },
  },
  month: {
    dayName: { borderLeft: 'none', backgroundColor: '#f8f9fa', color: '#70757a' },
    weekend: { backgroundColor: '#fafafa' },
    holidayExcessView: { color: '#d93025' },
    dayExcessView: { color: '#1a73e8' },
    moreView: { border: '1px solid #dadce0', backgroundColor: '#ffffff', boxShadow: '0 4px 12px rgba(0,0,0,0.15)' },
    moreViewTitle: { backgroundColor: '#f8f9fa' },
  },
};

// TUI Calendar dark theme
export const DARK_THEME = {
  common: {
    backgroundColor: '#1a1a28',
    border: '1px solid #2a2a3c',
    holiday: { color: '#c8607a' },
    saturday: { color: '#6d9ee8' },
    dayName: { color: '#a8b4cc' },
    today: { color: '#1a1a28', backgroundColor: '#6d9ee8' },
    gridSelection: { backgroundColor: 'rgba(109,158,232,0.1)', border: '1px solid #6d9ee8' },
  },
  week: {
    dayName: { borderLeft: 'none', borderTop: '1px solid #2a2a3c', borderBottom: '1px solid #2a2a3c', backgroundColor: '#151520' },
    dayGrid: { borderRight: '1px solid #2a2a3c', backgroundColor: '' },
    dayGridLeft: { borderRight: '1px solid #2a2a3c', backgroundColor: '#151520', width: '72px' },
    timeGrid: { borderRight: '1px solid #2a2a3c' },
    timeGridLeft: { backgroundColor: '#151520', borderRight: '1px solid #2a2a3c', width: '72px' },
    timeGridHourLine: { borderBottom: '1px solid #222234' },
    timeGridHalfHourLine: { borderBottom: 'none' },
    weekend: { backgroundColor: '#181826' },
    today: { color: '#a8b4cc', backgroundColor: 'rgba(109,158,232,0.07)' },
    pastDay: { color: '#484a5e' },
    pastTime: { color: '#484a5e' },
    gridSelection: { backgroundColor: 'rgba(109,158,232,0.1)', border: '1px solid #6d9ee8' },
  },
  month: {
    dayName: { borderLeft: 'none', backgroundColor: '#151520', color: '#a8b4cc' },
    weekend: { backgroundColor: '#181826' },
    holidayExcessView: { color: '#c8607a' },
    dayExcessView: { color: '#a8b4cc' },
    moreView: { border: '1px solid #2a2a3c', backgroundColor: '#1a1a28', boxShadow: '0 4px 12px rgba(0,0,0,0.6)' },
    moreViewTitle: { backgroundColor: '#151520' },
  },
};
