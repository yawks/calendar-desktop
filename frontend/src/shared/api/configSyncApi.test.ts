import { describe, expect, it } from 'vitest';
import { configWebDavUrl, decodeConfigInvitation, encodeConfigInvitation } from './configSyncApi';

describe('configWebDavUrl', () => {
  it('builds the private Nextcloud WebDAV resource URL', () => {
    expect(configWebDavUrl({ serverUrl: 'https://cloud.example.com/', username: 'alice@example.com' }))
      .toBe('https://cloud.example.com/remote.php/dav/files/alice%40example.com/.courrier-config-v1.enc');
  });

  it('requires HTTPS and a username', () => {
    expect(() => configWebDavUrl({ serverUrl: 'http://cloud.example.com', username: 'alice' })).toThrow('nextcloudHttpsRequired');
    expect(() => configWebDavUrl({ serverUrl: 'https://cloud.example.com', username: ' ' })).toThrow('nextcloudUsernameRequired');
  });

  it('round-trips a versioned invitation including the recovery key', () => {
    const encoded = encodeConfigInvitation({ serverUrl: 'https://cloud.example.com/', username: 'alice', recoveryKey: 'secret-key' });
    expect(decodeConfigInvitation(encoded)).toEqual({
      type: 'courrier-config-invitation', version: 1, serverUrl: 'https://cloud.example.com', username: 'alice', recoveryKey: 'secret-key',
    });
  });
});
