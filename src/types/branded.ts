export type ToolCallId = string & { readonly __brand: 'ToolCallId' };
export type ModelId = string & { readonly __brand: 'ModelId' };

export const toToolCallId = (raw: string): ToolCallId => raw as ToolCallId;
export const toModelId = (raw: string): ModelId => raw as ModelId;