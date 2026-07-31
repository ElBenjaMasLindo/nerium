export const splitLines = (text: string): { lines: string[]; rest: string } => {
  const parts = text.split('\n');
  const rest = parts[parts.length - 1] ?? '';
  const lines = parts.slice(0, -1).map((l) => l.replace(/\r$/, ''));
  return { lines, rest };
};

export const stripPrefix = (line: string, prefixLength: number): string =>
  line.slice(prefixLength).replace(/^ /, '');