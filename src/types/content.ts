import type { Option } from './option.js';
import type { ToolCallId } from './branded.js';

type BaseBlock = { providerOptions: Option<Record<string, unknown>> };

export type ContentBlock =
  | (BaseBlock & { type: 'text'; text: string })
  | (BaseBlock & { type: 'media'; mimeType: string; data: string })
  | (BaseBlock & { type: 'tool_call'; id: ToolCallId; name: string; arguments: Record<string, unknown> })
  | (BaseBlock & { type: 'tool_result'; toolCallId: ToolCallId; result: Record<string, unknown> })
  | (BaseBlock & { type: 'reasoning'; text: string })
  | (BaseBlock & { type: 'opaque'; subtype: string; raw: unknown });

export type ContentBlockStart =
  | { type: 'text' }
  | { type: 'media'; mimeType: string }
  | { type: 'tool_call'; id: ToolCallId; name: string }
  | { type: 'reasoning' }
  | { type: 'opaque'; subtype: string };

export type ContentBlockDelta =
  | { type: 'text'; text: string }
  | { type: 'media'; data: string }
  | { type: 'tool_call'; argumentsFragment: string }
  | { type: 'reasoning'; text: string }
  | { type: 'opaque'; raw: unknown };