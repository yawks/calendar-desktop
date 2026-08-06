import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import type { MailProvider } from '../providers/MailProvider';
import { avatarColor, initials } from '../utils';

interface ContactAvatarProps {
  readonly email: string;
  readonly name?: string;
  readonly provider?: Pick<MailProvider, 'accountId' | 'providerType' | 'getContactPhoto'> | null;
  readonly size?: number;
  readonly className?: string;
}

export function ContactAvatar({ email, name, provider, size = 32, className = '' }: ContactAvatarProps) {
  const [failed, setFailed] = useState<Set<string>>(new Set());
  const queryClient = useQueryClient();
  const displayName = name || email;
  const emailKey = email.toLowerCase();
  const nameKey = name?.trim().toLowerCase() || null;

  const hasNativePhotoProvider = !!provider?.getContactPhoto;
  const { data: photoBase64 } = useQuery<string | null>({
    queryKey: ['contact-photo', provider?.accountId, provider?.providerType, emailKey],
    queryFn: () => provider?.getContactPhoto?.(email) ?? Promise.resolve(null),
    staleTime: 10 * 60 * 1000,
    enabled: hasNativePhotoProvider,
  });

  // Populate a provider-agnostic cache so contexts without a provider (calendar,
  // search bar) can display the same photo already fetched by the mail view.
  useEffect(() => {
    if (photoBase64) {
      queryClient.setQueryData(['contact-photo-by-email', emailKey], photoBase64);
      if (nameKey) {
        queryClient.setQueryData(['contact-photo-by-name', nameKey], photoBase64);
      }
    }
  }, [photoBase64, emailKey, nameKey, queryClient]);

  // When no provider is available, fall back to the email-keyed photo cache.
  const { data: cachedPhotoByEmail } = useQuery<string | null>({
    queryKey: ['contact-photo-by-email', emailKey],
    queryFn: () => Promise.resolve(null),
    enabled: !hasNativePhotoProvider,
    staleTime: 10 * 60 * 1000,
  });

  // Exchange conversation summaries may only expose the sender's display name,
  // whereas the expanded message contains their SMTP address. Reuse the photo
  // fetched by the message header so both places render the same contact avatar.
  const { data: cachedPhotoByName } = useQuery<string | null>({
    queryKey: ['contact-photo-by-name', nameKey],
    queryFn: () => Promise.resolve(null),
    enabled: !!nameKey,
    staleTime: 10 * 60 * 1000,
  });

  const providerSrc = photoBase64 ? `data:image/jpeg;base64,${photoBase64}` : null;
  const cachedSrc = cachedPhotoByEmail ? `data:image/jpeg;base64,${cachedPhotoByEmail}` : null;
  const nameCachedSrc = cachedPhotoByName ? `data:image/jpeg;base64,${cachedPhotoByName}` : null;
  const effectiveSrc = providerSrc ?? cachedSrc ?? nameCachedSrc;
  const sources = [effectiveSrc].filter((s): s is string => !!s);
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
