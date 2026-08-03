/** Returns a Gravatar URL for the given email (SHA-256, Gravatar v3 format, no www). */
export async function gravatarUrl(email: string, size = 80): Promise<string> {
  const normalized = email.trim().toLowerCase();
  const encoded = new TextEncoder().encode(normalized);
  const hash = await crypto.subtle.digest('SHA-256', encoded);
  const hex = Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
  // SHA-256 is supported on gravatar.com (without www) — returns 404 if no account
  return `https://gravatar.com/avatar/${hex}?s=${size}&d=404`;
}

/** Returns a logo.dev URL for the domain of the given email. Requires a token; returns '' if none. */
export function domainLogoUrl(email: string, token: string): string {
  if (!token) return '';
  const domain = email.split('@')[1] ?? '';
  if (!domain) return '';
  return `https://img.logo.dev/${domain}?token=${token}&fallback=404&format=png`;
}
