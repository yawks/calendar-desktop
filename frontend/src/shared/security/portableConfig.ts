export type PortableConfigPayload = Record<string, unknown>;

/** Configuration shared between Courrier installations through Nextcloud. */
export const PORTABLE_CONFIG_KEYS = [
  'calendar-desktop-google-accounts',
  'calendar-desktop-exchange-accounts',
  'calendar-desktop-imap-accounts',
  'calendar-desktop-jmap-accounts',
  'calendar-desktop-calendars',
  'logodev-token',
  'courrier:signatures',
  'courrier:signaturePosition',
] as const;

const portableConfigKeySet = new Set<string>(PORTABLE_CONFIG_KEYS);

function portableValue(key: string, value: unknown): unknown {
  if ((key === 'calendar-desktop-google-accounts' || key === 'calendar-desktop-exchange-accounts') && Array.isArray(value)) {
    return value.map(account => account && typeof account === 'object'
      ? { ...account, accessToken: '', expiresAt: 0 }
      : account);
  }
  return value;
}

export function isPortableConfigKey(key: string): boolean {
  return portableConfigKeySet.has(key);
}

export function portableValuesEqual(key: string, left: unknown, right: unknown): boolean {
  try { return JSON.stringify(portableValue(key, left)) === JSON.stringify(portableValue(key, right)); }
  catch { return Object.is(left, right); }
}

export interface PortableConfigSummary {
  googleSources: number;
  exchangeSources: number;
  imapSources: number;
  jmapSources: number;
  calendars: number;
  signatures: number;
  hasLogoDevToken: boolean;
}

export function portableConfigSummary(payload: PortableConfigPayload): PortableConfigSummary {
  const count = (key: string) => Array.isArray(payload[key]) ? payload[key].length : 0;
  const signatures = payload['courrier:signatures'];
  return {
    googleSources: count('calendar-desktop-google-accounts'),
    exchangeSources: count('calendar-desktop-exchange-accounts'),
    imapSources: count('calendar-desktop-imap-accounts'),
    jmapSources: count('calendar-desktop-jmap-accounts'),
    calendars: count('calendar-desktop-calendars'),
    signatures: signatures && typeof signatures === 'object' ? Object.keys(signatures).length : 0,
    hasLogoDevToken: typeof payload['logodev-token'] === 'string' && payload['logodev-token'] !== '',
  };
}

export function pickPortableConfig(payload: PortableConfigPayload): PortableConfigPayload {
  const portable: PortableConfigPayload = {};
  for (const key of PORTABLE_CONFIG_KEYS) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) portable[key] = portableValue(key, payload[key]);
  }
  return portable;
}

/** Replaces shared fields while preserving settings that belong to this device. */
export function applyPortableConfig(
  localPayload: PortableConfigPayload,
  remotePayload: PortableConfigPayload,
): PortableConfigPayload {
  const merged = { ...localPayload };
  for (const key of PORTABLE_CONFIG_KEYS) delete merged[key];
  return { ...merged, ...pickPortableConfig(remotePayload) };
}
