export type ToolCallId = string & { readonly __brand: 'ToolCallId' };
export type ModelId = string & { readonly __brand: 'ModelId' };

export const toToolCallId = (raw: string): ToolCallId => raw as ToolCallId; // sadist-exception: brand-cast
export const toModelId = (raw: string): ModelId => raw as ModelId; // sadist-exception: brand-cast