import { apiHeaders, apiJson, apiUrl } from './apiRequest';
import { hasNativeTransport, invokeNative } from './nativeTransport';
import type { EncryptedVault } from '../security/vaultCrypto';

export interface NextcloudConfigLocation {
  serverUrl: string;
  username: string;
  password: string;
  recoveryKey?: string;
}

export interface ConfigInvitation { type: 'courrier-config-invitation'; version: 1; serverUrl: string; username: string; recoveryKey: string }
export interface RemoteVaultDocument { format: 'courrier-config'; version: 1; deviceId: string; revision: number; updatedAt: string; vault: EncryptedVault }
export interface RemoteVaultResult { exists: boolean; document?: RemoteVaultDocument; etag?: string }

export class ConfigSyncConflictError extends Error {
  constructor() { super('configSyncConflict'); }
}

export function configWebDavUrl(location: Pick<NextcloudConfigLocation, 'serverUrl' | 'username'>): string {
  const server = location.serverUrl.trim().replace(/\/+$/, '');
  if (!/^https:\/\//i.test(server)) throw new Error('nextcloudHttpsRequired');
  if (!location.username.trim()) throw new Error('nextcloudUsernameRequired');
  return `${server}/remote.php/dav/files/${encodeURIComponent(location.username.trim())}/.courrier-config-v1.enc`;
}

async function command<T>(name: string, args: Record<string, unknown>): Promise<T> {
  if (hasNativeTransport()) return invokeNative<T>(name, args);
  const response = await fetch(apiUrl('/api/calendar/config'), {
    method: name === 'config_webdav_put' ? 'PUT' : 'POST', credentials: 'same-origin', headers: apiHeaders({ 'content-type': 'application/json' }), body: JSON.stringify(args),
  });
  return apiJson<T>(response);
}

function parseDocument(content: string): RemoteVaultDocument {
  const value = JSON.parse(content) as RemoteVaultDocument | EncryptedVault;
  if ('format' in value && value.format === 'courrier-config' && value.version === 1 && value.vault) return value;
  if ('kdf' in value && value.version === 1) {
    return { format: 'courrier-config', version: 1, deviceId: 'legacy', revision: 0, updatedAt: new Date(0).toISOString(), vault: value };
  }
  throw new Error('invalidRemoteVault');
}

export async function fetchRemoteVault(location: NextcloudConfigLocation): Promise<RemoteVaultResult> {
  const result = await command<{ exists: boolean; content?: string; etag?: string }>('config_webdav_fetch', {
    url: configWebDavUrl(location), username: location.username.trim(), password: location.password,
  });
  if (!result.exists) return { exists: false };
  if (!result.content) throw new Error('invalidRemoteVault');
  return { exists: true, document: parseDocument(result.content), etag: result.etag };
}

export async function putRemoteVault(location: NextcloudConfigLocation, document: RemoteVaultDocument, etag?: string): Promise<string | undefined> {
  const result = await command<{ ok: boolean; conflict?: boolean; etag?: string }>('config_webdav_put', {
    url: configWebDavUrl(location), username: location.username.trim(), password: location.password,
    content: JSON.stringify(document), ifMatch: etag,
  });
  if (result.conflict) throw new ConfigSyncConflictError();
  if (!result.ok) throw new Error('configSyncFailed');
  return result.etag;
}

export function encodeConfigInvitation(location: Pick<NextcloudConfigLocation, 'serverUrl' | 'username' | 'recoveryKey'>): string {
  if (!location.recoveryKey) throw new Error('missingRecoveryKey');
  const invitation: ConfigInvitation = { type: 'courrier-config-invitation', version: 1, serverUrl: location.serverUrl.trim().replace(/\/+$/, ''), username: location.username.trim(), recoveryKey: location.recoveryKey };
  const bytes = new TextEncoder().encode(JSON.stringify(invitation)); let binary = '';
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return `courrier://config/import?v=1&data=${encodeURIComponent(btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''))}`;
}

export function decodeConfigInvitation(raw: string): ConfigInvitation {
  const url = new URL(raw.trim());
  if (url.protocol !== 'courrier:' || url.hostname !== 'config' || url.pathname !== '/import' || url.searchParams.get('v') !== '1') throw new Error('invalidConfigInvitation');
  const encoded = url.searchParams.get('data'); if (!encoded) throw new Error('invalidConfigInvitation');
  const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(encoded.length / 4) * 4, '=');
  const invitation = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(base64), char => char.charCodeAt(0)))) as ConfigInvitation;
  if (invitation.type !== 'courrier-config-invitation' || invitation.version !== 1 || !invitation.serverUrl || !invitation.username || !invitation.recoveryKey) throw new Error('invalidConfigInvitation');
  configWebDavUrl(invitation);
  return invitation;
}
