import type { Connection, Client } from '../types/connection.js';

export const createClient = <T extends Readonly<Record<string, Connection>>>(
  connections: T,
  defaultAlias: keyof T,
): Client<keyof T & string> => ({
  connection: (alias) => connections[alias ?? defaultAlias] as Connection,
});