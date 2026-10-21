import { platform } from '../platform';
import { getTauriInvoke } from '../platform/tauriRuntime';

export function hasNativeTransport(): boolean {
  return Boolean(platform.mailCommand || getTauriInvoke());
}

export function invokeNative<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  if (platform.mailCommand) return platform.mailCommand<T>(command, args);
  const invoke = getTauriInvoke();
  if (!invoke) return Promise.reject(new Error('Native transport unavailable'));
  return invoke<T>('mail_command', { command, args });
}
