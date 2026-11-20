export interface PortalCredentials {
  username: string;
  password: string;
}

/** Credentials live in a secrets manager. Callers receive them and must not write them to logs. */
export interface Secrets {
  get(key: string): Promise<PortalCredentials | null>;
}

export function memorySecrets(entries: Record<string, PortalCredentials>): Secrets {
  return {
    async get(key) {
      const found = entries[key];
      return found ? { ...found } : null;
    },
  };
}

export const EMPTY_SECRETS: Secrets = { async get() { return null; } };
