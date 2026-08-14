import { ArrowRight, CalendarDays, Mail } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

export default function WelcomeScreen() {
  const { t } = useTranslation();

  return (
    <main className="welcome-screen">
      <div className="welcome-brand welcome-brand--top" aria-label={t('header.appName')}>
        <img src="/icon.png" alt="" className="welcome-brand__logo" />
        <span>{t('header.appName')}</span>
      </div>
      <section className="welcome-card">
        <div className="welcome-mark" aria-hidden="true">
          <Mail size={30} />
          <CalendarDays size={30} />
        </div>
        <h1>{t('welcome.title')}</h1>
        <p>{t('welcome.description')}</p>
        <Link to="/config?addSource=1" className="btn-primary welcome-action">
          {t('welcome.addSource')}
          <ArrowRight size={16} />
        </Link>
      </section>
    </main>
  );
}
