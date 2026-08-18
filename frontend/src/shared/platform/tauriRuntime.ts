export type TauriInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

type TauriGlobals = typeof globalThis & {
  __TAURI__?: { core?: { invoke?: TauriInvoke } };
  __TAURI_INTERNALS__?: { invoke?: TauriInvoke };
};

export function getTauriInvoke(): TauriInvoke | undefined {
  const runtime = globalThis as TauriGlobals;
  return runtime.__TAURI__?.core?.invoke ?? runtime.__TAURI_INTERNALS__?.invoke;
}

export function isTauriRuntime(): boolean {
  return Boolean(getTauriInvoke());
}
