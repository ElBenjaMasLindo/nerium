import type { Option } from './option.js';

export type HttpRequest = {
  method: 'GET' | 'POST';
  url: string;
  headers: Readonly<Record<string, string>>;
  body: Option<string>;
};

export type RawHttpResponse = {
  status: number;
  headers: Readonly<Record<string, string>>;
  body: string;
};

export type RawStreamEvent = {
  eventName: Option<string>;
  data: string;
};