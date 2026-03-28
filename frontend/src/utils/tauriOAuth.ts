import { invoke } from '@tauri-apps/api/core';
import { GoogleAccount } from '../types';
import { resolveGoogleCredentials } from '../store/googleClientConfig';

// ── Detection ─────────────────────────────────────────────────────────────────

export function isTauri(): boolean {
  return '__TAURI_INTERNALS__' in globalThis;
}

// ── PKCE helpers ──────────────────────────────────────────────────────────────

function generateCodeVerifier(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return btoa(String.fromCodePoint(...array))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCodePoint(...new Uint8Array(hash)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

function generateState(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, '0')).join('');
}

// ── Token exchange (no client_secret for desktop apps) ────────────────────────

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';
const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'openid',
  'email',
  'profile',
].join(' ');

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  error?: string;
  error_description?: string;
}

async function exchangeCode(
  code: string,
  codeVerifier: string,
  redirectUri: string,
  clientId: string,
  clientSecret: string
): Promise<Omit<GoogleAccount, 'id'>> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      // For desktop/installed apps the secret is not truly confidential
      // (Google embeds it in the app), but the endpoint still requires it.
      client_secret: clientSecret,
      code,
      code_verifier: codeVerifier,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });

  const tokens: TokenResponse = await res.json();
  if (tokens.error || !tokens.access_token) {
    throw new Error(tokens.error_description ?? tokens.error ?? 'Échec de l\'échange de token');
  }

  const profileRes = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  const profile = await profileRes.json() as { email: string; name: string; picture?: string };

  return {
    email: profile.email,
    name: profile.name,
    picture: profile.picture,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? '',
    expiresAt: Date.now() + (tokens.expires_in - 60) * 1000,
  };
}

// ── Token refresh (no client_secret for desktop apps) ─────────────────────────

export async function refreshAccessToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string
): Promise<{ accessToken: string; expiresAt: number }> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  const data: TokenResponse = await res.json();
  if (data.error || !data.access_token) {
    throw new Error(data.error_description ?? data.error ?? 'Échec du refresh');
  }

  return {
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  };
}

// ── Main OAuth flow ────────────────────────────────────────────────────────────
//
// Flow :
//   1. Rust démarre un serveur TCP sur un port aléatoire → renvoie le port
//   2. Frontend construit l'URL OAuth et ouvre le navigateur système
//   3. L'utilisateur autorise → Google redirige vers http://127.0.0.1:PORT/?code=…
//   4. Rust capture le code et le renvoie via invoke('wait_oauth_code')
//   5. Frontend échange le code contre des tokens directement avec Google (PKCE, pas de secret)

export async function tauriConnectGoogle(): Promise<Omit<GoogleAccount, 'id'> | null> {
  const { clientId, clientSecret } = resolveGoogleCredentials();

  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  const state = generateState();

  // 1. Démarrer le serveur TCP local (retourne immédiatement avec le port)
  const port = await invoke<number>('start_oauth_listener');
  const redirectUri = `http://127.0.0.1:${port}`;

  // 2. Ouvrir le navigateur
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GOOGLE_SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
  });

  await invoke('open_url', { url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` });

  // 3. Attendre le callback (bloquant côté Rust, timeout 5 min)
  const callback = await invoke<{ code?: string; state?: string; error?: string }>('wait_oauth_code');

  if (callback.error || !callback.code) {
    return null;
  }

  if (callback.state !== state) {
    throw new Error('State mismatch — possible attaque CSRF');
  }

  // 4. Échanger le code contre des tokens (directement, sans proxy)
  return exchangeCode(callback.code, codeVerifier, redirectUri, clientId, clientSecret);
}
