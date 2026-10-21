import { platform } from '../platform';

const NATIVE_SETTINGS_KEY = 'courrier-native-settings-v1';

type NativeServerSettings = { serverUrl?: unknown; serverUsername?: unknown; serverPassword?: unknown };

function nativeServerSettings(): NativeServerSettings {
  try { return JSON.parse(localStorage.getItem(NATIVE_SETTINGS_KEY) ?? '{}') as NativeServerSettings; }
  catch { return {}; }
}

export function apiUrl(path: string): string {
  if (!platform.isNativeAndroid) return path;
  let serverUrl = '';
  const settings = nativeServerSettings();
  if (typeof settings.serverUrl === 'string') serverUrl = settings.serverUrl.trim().replace(/\/+$/, '');
  if (!serverUrl.startsWith('https://')) {
    throw new Error("Configurez une URL HTTPS du serveur Courrier dans les préférences Android.");
  }
  return `${serverUrl}${path}`;
}

export function apiHeaders(headers: Record<string, string> = {}): Record<string, string> {
  if (!platform.isNativeAndroid) return headers;
  const settings = nativeServerSettings();
  const username = typeof settings.serverUsername === 'string' ? settings.serverUsername : '';
  const password = typeof settings.serverPassword === 'string' ? settings.serverPassword : '';
  if (!username && !password) return headers;
  const bytes = new TextEncoder().encode(`${username}:${password}`);
  let binary = '';
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return { ...headers, Authorization: `Basic ${btoa(binary)}` };
}

export async function apiJson<T>(response: Response): Promise<T> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`Réponse API invalide (HTTP ${response.status})`);
  }
  if (!response.ok) {
    const message = payload && typeof payload === 'object' && 'error' in payload
      ? String((payload as { error: unknown }).error)
      : `HTTP ${response.status}`;
    throw new Error(message);
  }
  return payload as T;
}
