export const splitLines = (text: string): { lines: string[]; rest: string } => {
  let work = text;
  let trailingCR = false;
  if (work.endsWith('\r')) {
    work = work.slice(0, -1);
    trailingCR = true;
  }
  const normalized = work.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const parts = normalized.split('\n');
  const rest = (parts.pop() ?? '') + (trailingCR ? '\r' : '');
  return { lines: parts, rest };
};

export const stripPrefix = (line: string, prefixLength: number): string =>
  line.slice(prefixLength).replace(/^ /, '');