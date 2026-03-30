import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';

interface Props {
  currentDate: Date;
  onSelectDate: (date: Date) => void;
}

export default function MiniCalendar({ currentDate, onSelectDate }: Props) {
  const { t } = useTranslation();
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

  const locale = i18n.language === 'fr' ? 'fr-FR' : 'en-US';
  const label = displayMonth.toLocaleDateString(locale, { month: 'long', year: 'numeric' });
  const dayNames = t('miniCalendar.dayNames', { returnObjects: true }) as string[];

  return (
    <div className="mini-cal">
      <div className="mini-cal-header">
        <button
          type="button"
          className="mini-cal-nav"
          onClick={() => setDisplayMonth(new Date(year, mo - 1, 1))}
          aria-label={t('miniCalendar.prevMonth')}
        >
          <ChevronLeft size={14} />
        </button>
        <span className="mini-cal-month">{label}</span>
        <button
          type="button"
          className="mini-cal-nav"
          onClick={() => setDisplayMonth(new Date(year, mo + 1, 1))}
          aria-label={t('miniCalendar.nextMonth')}
        >
          <ChevronRight size={14} />
        </button>
      </div>
      <div className="mini-cal-grid">
        {dayNames.map((n, i) => (
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
