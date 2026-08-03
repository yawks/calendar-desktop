import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { useLogoDevToken } from '../../../shared/store/LogoDevTokenStore';
import type { MailProvider } from '../providers/MailProvider';
import { avatarColor, initials } from '../utils';
import { domainLogoUrl, gravatarUrl } from '../utils/gravatar';

interface ContactAvatarProps {
  readonly email: string;
  readonly name?: string;
  readonly provider?: Pick<MailProvider, 'accountId' | 'providerType' | 'getContactPhoto'> | null;
  readonly size?: number;
  readonly className?: string;
}

export function ContactAvatar({ email, name, provider, size = 32, className = '' }: ContactAvatarProps) {
  const [failed, setFailed] = useState<Set<string>>(new Set());
  const { token: logoDevToken } = useLogoDevToken();
  const displayName = name || email;

  const hasNativePhotoProvider = !!provider?.getContactPhoto;
  const { data: photoBase64, isFetched: nativePhotoFetched } = useQuery<string | null>({
    queryKey: ['contact-photo', provider?.accountId, provider?.providerType, email.toLowerCase()],
    queryFn: () => provider?.getContactPhoto?.(email) ?? Promise.resolve(null),
    staleTime: 10 * 60 * 1000,
    enabled: hasNativePhotoProvider,
  });

  // Gravatar and logo.dev are image-only fallbacks. They never participate in
  // contact discovery and are only tried after the native provider has no photo.
  const { data: gravatarSrc } = useQuery<string>({
    queryKey: ['gravatar', email],
    queryFn: () => gravatarUrl(email, size * 2),
    staleTime: Infinity,
  });

  const providerSrc = photoBase64 ? `data:image/jpeg;base64,${photoBase64}` : null;
  const domainSrc = domainLogoUrl(email, logoDevToken) || null;

  const nativeLookupComplete = !hasNativePhotoProvider || nativePhotoFetched;
  const sources = [
    providerSrc,
    ...(nativeLookupComplete && !providerSrc ? [gravatarSrc ?? null, domainSrc] : []),
  ].filter((s): s is string => !!s);
  const currentSrc = sources.find(s => !failed.has(s));

  const handleError = (src: string) => setFailed(prev => new Set([...prev, src]));

  if (currentSrc) {
    return (
      <div
        className={`contact-avatar ${className}`}
        style={{ width: size, height: size }}
        aria-label={displayName}
      >
        <img
          src={currentSrc}
          alt={displayName}
          className="contact-avatar--img"
          onError={() => handleError(currentSrc)}
        />
      </div>
    );
  }

  return (
    <div
      className={`contact-avatar ${className}`}
      style={{ background: avatarColor(displayName), width: size, height: size, fontSize: size * 0.4 }}
      aria-label={displayName}
    >
      {initials(displayName)}
    </div>
  );
}
