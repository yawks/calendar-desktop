import { createContext, useCallback, useContext, useState } from 'react';
import type { ReactNode } from 'react';

export type SignaturePosition = 'bottom' | 'above-quoted';

interface SignatureState {
  signatures: Record<string, string>;
  signaturePosition: SignaturePosition;
  getSignature: (identityId: string) => string;
  setSignature: (identityId: string, html: string) => void;
  setSignaturePosition: (position: SignaturePosition) => void;
}

const STORAGE_KEY_SIGS = 'courrier:signatures';
const STORAGE_KEY_POS = 'courrier:signaturePosition';

function loadSignatures(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY_SIGS) ?? '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

function loadPosition(): SignaturePosition {
  return localStorage.getItem(STORAGE_KEY_POS) === 'above-quoted' ? 'above-quoted' : 'bottom';
}

const SignatureContext = createContext<SignatureState | null>(null);

export function SignatureProvider({ children }: { children: ReactNode }) {
  const [signatures, setSignatures] = useState<Record<string, string>>(loadSignatures);
  const [signaturePosition, setSignaturePositionState] = useState<SignaturePosition>(loadPosition);

  const getSignature = useCallback((id: string) => signatures[id] ?? '', [signatures]);

  const setSignature = useCallback((id: string, html: string) => {
    setSignatures(prev => {
      const next = { ...prev, [id]: html };
      localStorage.setItem(STORAGE_KEY_SIGS, JSON.stringify(next));
      return next;
    });
  }, []);

  const setSignaturePosition = useCallback((pos: SignaturePosition) => {
    setSignaturePositionState(pos);
    localStorage.setItem(STORAGE_KEY_POS, pos);
  }, []);

  return (
    <SignatureContext.Provider value={{ signatures, signaturePosition, getSignature, setSignature, setSignaturePosition }}>
      {children}
    </SignatureContext.Provider>
  );
}

export function useSignatures() {
  const ctx = useContext(SignatureContext);
  if (!ctx) throw new Error('useSignatures must be used within SignatureProvider');
  return ctx;
}

export function buildInitialHTMLWithSignature(
  bodyHtml: string,
  signatureHtml: string,
  position: SignaturePosition,
): string {
  if (!signatureHtml) return bodyHtml;
  const sigBlock = `<div data-courrier-sig="1">${signatureHtml}</div>`;
  if (!bodyHtml) return `<p></p>${sigBlock}`;

  if (position === 'above-quoted') {
    // Insert before the first mail-quoted block
    const idx = bodyHtml.indexOf('<div class="mail-quoted');
    if (idx !== -1) {
      return bodyHtml.slice(0, idx) + sigBlock + bodyHtml.slice(idx);
    }
  }
  // Default: append at the very end
  return bodyHtml + sigBlock;
}
