import * as React from 'react';

const SessionEncryptionContext = React.createContext<Uint8Array | null>(null);

export const SessionEncryptionProvider = SessionEncryptionContext.Provider;

export function useSessionEncryption(): Uint8Array | null {
    return React.useContext(SessionEncryptionContext);
}
