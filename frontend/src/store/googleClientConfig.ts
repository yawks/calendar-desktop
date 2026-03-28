const STORAGE_KEY = 'calendar-desktop-google-client';

export interface GoogleClientConfig {
  clientId: string;
  clientSecret: string;
}

export function getGoogleClientConfig(): GoogleClientConfig | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return null;
    const config = JSON.parse(stored) as GoogleClientConfig;
    return config.clientId && config.clientSecret ? config : null;
  } catch {
    return null;
  }
}

export function setGoogleClientConfig(config: GoogleClientConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

export function clearGoogleClientConfig(): void {
  localStorage.removeItem(STORAGE_KEY);
}

/** Résout les credentials dans l'ordre : config UI → variables d'environnement */
export function resolveGoogleCredentials(): { clientId: string; clientSecret: string } {
  const stored = getGoogleClientConfig();
  const clientId = stored?.clientId || (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined);
  const clientSecret = stored?.clientSecret || (import.meta.env.VITE_GOOGLE_CLIENT_SECRET as string | undefined);
  if (!clientId || !clientSecret) {
    throw new Error(
      'Client ID et Client Secret Google non configurés. ' +
      'Renseignez-les dans Paramètres → onglet Google, ou créez un fichier .env.'
    );
  }
  return { clientId, clientSecret };
}
