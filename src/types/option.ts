export type Option<T> = { some: true; value: T } | { some: false };

export const some = <T>(value: T): Option<T> => ({ some: true, value });
export const none: Option<never> = { some: false };