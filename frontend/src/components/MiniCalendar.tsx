import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface Props {
  currentDate: Date;
  onSelectDate: (date: Date) => void;
}

const DAY_NAMES = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

export default function MiniCalendar({ currentDate, onSelectDate }: Props) {
  const [displayMonth, setDisplayMonth] = useState(
    () => new Date(currentDate.getFullYear(), currentDate.getMonth(), 1)
  );

  // Sync display month when the main calendar navigates to a different month.
  const cy = currentDate.getFullYear();
  const cm = currentDate.getMonth();
  useEffect(() => {
    setDisplayMonth(new Date(cy, cm, 1));
  }, [cy, cm]);

  const year = displayMonth.getFullYear();
  const mo = displayMonth.getMonth();

  const firstWeekday = (new Date(year, mo, 1).getDay() + 6) % 7; // 0 = Monday
  const daysInMonth = new Date(year, mo + 1, 0).getDate();

  const today = new Date();
  const todayKey = `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`;
  const selKey = `${currentDate.getFullYear()}-${currentDate.getMonth()}-${currentDate.getDate()}`;

  const cells: (number | null)[] = Array(firstWeekday).fill(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const label = displayMonth.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

  return (
    <div className="mini-cal">
      <div className="mini-cal-header">
        <button
          type="button"
          className="mini-cal-nav"
          onClick={() => setDisplayMonth(new Date(year, mo - 1, 1))}
          aria-label="Mois précédent"
        >
          <ChevronLeft size={14} />
        </button>
        <span className="mini-cal-month">{label}</span>
        <button
          type="button"
          className="mini-cal-nav"
          onClick={() => setDisplayMonth(new Date(year, mo + 1, 1))}
          aria-label="Mois suivant"
        >
          <ChevronRight size={14} />
        </button>
      </div>
      <div className="mini-cal-grid">
        {DAY_NAMES.map((n, i) => (
          <div key={i} className="mini-cal-dn">{n}</div>
        ))}
        {cells.map((day, i) => {
          if (!day) return <div key={i} />;
          const key = `${year}-${mo}-${day}`;
          const isToday = key === todayKey;
          const isSel = key === selKey;
          return (
            <button
              key={i}
              type="button"
              className={`mini-cal-day${isToday ? ' today' : ''}${isSel ? ' selected' : ''}`}
              onClick={() => onSelectDate(new Date(year, mo, day))}
            >
              {day}
            </button>
          );
        })}
      </div>
    </div>
  );
}
