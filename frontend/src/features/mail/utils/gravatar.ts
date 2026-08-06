/** Returns a Gravatar image as a data URL, or null when the contact has no avatar. */
export async function gravatarUrl(email: string, size = 80): Promise<string | null> {
  const normalized = email.trim().toLowerCase();
  const encoded = new TextEncoder().encode(normalized);
  const hash = await crypto.subtle.digest('SHA-256', encoded);
  const hex = Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
  const url = `https://gravatar.com/avatar/${hex}?s=${size}&d=404`;

  // Loading this URL directly in an <img> makes WebKit report every expected
  // "no avatar" response as a console error. Fetch it first so a 404 can be
  // treated as the normal initials/logo fallback without noisy diagnostics.
  try {
    const response = await fetch(url);
    if (!response.ok) return null;

    const blob = await response.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/** Returns a logo.dev URL for the domain of the given email. Requires a token; returns '' if none. */
export function domainLogoUrl(email: string, token: string): string {
  if (!token) return '';
  const domain = email.split('@')[1] ?? '';
  if (!domain) return '';
  return `https://img.logo.dev/${domain}?token=${token}&fallback=404&format=png`;
}
