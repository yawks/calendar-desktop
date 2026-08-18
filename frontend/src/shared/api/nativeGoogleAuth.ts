import type { GoogleAccount } from '../types';
import { platform } from '../platform';
import { invokeNative } from './nativeTransport';

type Capabilities = ('calendar' | 'email')[];
type Credentials = { clientId: string; clientSecret: string };
type OAuthCallback = { code?: string; state?: string; error?: string };
type TauriInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

function tauriInvoke(): TauriInvoke | undefined {
  return (window as Window & { __TAURI__?: { core?: { invoke?: TauriInvoke } } }).__TAURI__?.core?.invoke;
}

function randomUrlSafe(bytes: number): string {
  const data = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCodePoint(...data)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

async function challenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return btoa(String.fromCodePoint(...new Uint8Array(digest))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function scopes(capabilities: Capabilities): string[] {
  const values = ['openid', 'email', 'profile'];
  if (capabilities.includes('calendar')) values.push('https://www.googleapis.com/auth/calendar');
  if (capabilities.includes('email')) values.push('https://mail.google.com/', 'https://www.googleapis.com/auth/contacts.readonly', 'https://www.googleapis.com/auth/contacts.other.readonly');
  return values;
}

export function usesNativeGoogleAuth(): boolean {
  return Boolean(platform.googleAuthorize || tauriInvoke());
}

export async function connectNativeGoogle(capabilities: Capabilities, credentials: Credentials): Promise<Omit<GoogleAccount, 'id'>> {
  if (platform.googleAuthorize) {
    const result = await platform.googleAuthorize({ serverClientId: credentials.clientId, capabilities });
    return invokeNative('google_auth_exchange_code', {
      code: result.serverAuthCode,
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
    });
  }

  const invoke = tauriInvoke();
  if (!invoke) throw new Error('Native Google authorization is unavailable');
  const verifier = randomUrlSafe(48);
  const state = randomUrlSafe(24);
  const port = await invoke<number>('start_oauth_listener');
  const redirectUri = `http://127.0.0.1:${port}`;
  const query = new URLSearchParams({
    client_id: credentials.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: scopes(capabilities).join(' '),
    access_type: 'offline',
    prompt: 'consent',
    code_challenge: await challenge(verifier),
    code_challenge_method: 'S256',
    state,
  });
  await invoke('open_external_url', { url: `https://accounts.google.com/o/oauth2/v2/auth?${query}` });
  const callback = await invoke<OAuthCallback>('wait_oauth_code');
  if (callback.error || !callback.code) throw new Error(callback.error || 'Google authorization was cancelled');
  if (callback.state !== state) throw new Error('Google OAuth state mismatch');
  return invokeNative('google_auth_exchange_code', {
    code: callback.code,
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    redirect_uri: redirectUri,
    code_verifier: verifier,
  });
}
