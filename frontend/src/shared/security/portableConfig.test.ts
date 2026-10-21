import { describe, expect, it } from 'vitest';
import { applyPortableConfig, isPortableConfigKey, pickPortableConfig, portableConfigSummary, portableValuesEqual } from './portableConfig';

describe('portable Nextcloud configuration', () => {
  it('contains only sources and signatures', () => {
    expect(pickPortableConfig({
      'calendar-desktop-imap-accounts': [{ id: 'imap' }],
      'calendar-desktop-calendars': [{ id: 'calendar' }],
      'courrier:signatures': { imap: '<p>Regards</p>' },
      'courrier:signaturePosition': 'above-quoted',
      'logodev-token': 'logo-token',
      theme: 'dark',
      'courrier:config-sync-v1': { enabled: true },
    })).toEqual({
      'calendar-desktop-imap-accounts': [{ id: 'imap' }],
      'calendar-desktop-calendars': [{ id: 'calendar' }],
      'courrier:signatures': { imap: '<p>Regards</p>' },
      'courrier:signaturePosition': 'above-quoted',
      'logodev-token': 'logo-token',
    });
  });

  it('replaces shared fields and preserves device preferences', () => {
    expect(applyPortableConfig({
      'calendar-desktop-imap-accounts': [{ id: 'old' }],
      'courrier:signatures': { old: 'old' },
      theme: 'keep-me',
    }, {
      'calendar-desktop-imap-accounts': [{ id: 'new' }],
      theme: 'remote-theme',
    })).toEqual({
      'calendar-desktop-imap-accounts': [{ id: 'new' }],
      theme: 'keep-me',
    });
  });

  it('only schedules synchronization for portable fields', () => {
    expect(isPortableConfigKey('courrier:signatures')).toBe(true);
    expect(isPortableConfigKey('calendar-desktop-google-accounts')).toBe(true);
    expect(isPortableConfigKey('logodev-token')).toBe(true);
    expect(isPortableConfigKey('theme')).toBe(false);
  });

  it('summarizes portable data without exposing its contents', () => {
    expect(portableConfigSummary({
      'calendar-desktop-google-accounts': [{ email: 'secret@example.com' }],
      'calendar-desktop-calendars': [{ id: 'one' }, { id: 'two' }],
      'courrier:signatures': { secret: '<p>Private</p>' },
      'logodev-token': 'secret-token',
    })).toEqual({
      googleSources: 1,
      exchangeSources: 0,
      imapSources: 0,
      jmapSources: 0,
      calendars: 2,
      signatures: 1,
      hasLogoDevToken: true,
    });
  });

  it('ignores temporary access-token refreshes but detects new accounts', () => {
    const account = { id: 'one', refreshToken: 'durable', accessToken: 'old', expiresAt: 1 };
    expect(portableValuesEqual('calendar-desktop-google-accounts', [account], [
      { ...account, accessToken: 'new', expiresAt: 2 },
    ])).toBe(true);
    expect(portableValuesEqual('calendar-desktop-google-accounts', [account], [
      account,
      { ...account, id: 'two' },
    ])).toBe(false);
    expect(pickPortableConfig({ 'calendar-desktop-google-accounts': [account] }))
      .toEqual({ 'calendar-desktop-google-accounts': [{ ...account, accessToken: '', expiresAt: 0 }] });
  });
});
