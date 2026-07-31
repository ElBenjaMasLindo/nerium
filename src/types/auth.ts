import type { HttpRequest } from './http-wire.js';

export type Credential =
  | { type: 'value'; value: string }
  | { type: 'resolver'; resolve: () => Promise<string> };

export type AuthConfig =
  | { type: 'static'; credential: Credential; location: 'header' | 'query'; key: string }
  | { type: 'signed'; sign: (request: HttpRequest) => Promise<HttpRequest> }
  | { type: 'none' };