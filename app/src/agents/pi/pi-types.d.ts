/**
 * pi-types.d.ts — Locally-vendored type stubs for @earendil-works/pi-ai and
 * @earendil-works/pi-agent-core.
 *
 * These are hand-copied from the spike's node_modules (2026-08-03 snapshot,
 * pi-agent-core@0.83.0 / pi-ai@0.83.0) so that Phase 1 sub-thread B can
 * typecheck without adding the real packages to app/package.json (Phase 2).
 *
 * When Phase 2 adds the real packages, delete this file and update imports in
 * streamFn.ts / toolContext.ts / testing.ts to use the real module paths.
 *
 * Rule: signatures must be structurally equivalent to the real types —
 * field names and shapes are identical, comments trimmed for brevity.
 */

// ---------------------------------------------------------------------------
// Core primitive types (from @earendil-works/pi-ai)
// ---------------------------------------------------------------------------

export type Api = string;

export type StopReason = "pending" | "stop" | "length" | "toolUse" | "error" | "aborted";

export interface TextContent {
  type: "text";
  text: string;
  textSignature?: string;
}

export interface ThinkingContent {
  type: "thinking";
  thinking: string;
  thinkingSignature?: string;
  redacted?: boolean;
}

export interface ImageContent {
  type: "image";
  data: string;
  mimeType: string;
}

export interface ToolCall {
  type: "toolCall";
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  thoughtSignature?: string;
}

export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cacheWrite1h?: number;
  reasoning?: number;
  totalTokens: number;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
}

export interface UserMessage {
  role: "user";
  content: string | (TextContent | ImageContent)[];
  timestamp: number;
}

export interface AssistantMessage {
  role: "assistant";
  content: (TextContent | ThinkingContent | ToolCall)[];
  api: Api;
  provider: string;
  model: string;
  responseModel?: string;
  responseId?: string;
  usage: Usage;
  stopReason: StopReason;
  errorMessage?: string;
  rawStopReason?: string;
  timestamp: number;
}

export interface ToolResultMessage {
  role: "toolResult";
  toolCallId: string;
  toolName: string;
  content: (TextContent | ImageContent)[];
  details?: unknown;
  usage?: Usage;
  addedToolNames?: string[];
  isError: boolean;
  timestamp: number;
}

export type Message = UserMessage | AssistantMessage | ToolResultMessage;

// ---------------------------------------------------------------------------
// AssistantMessageEvent protocol (from @earendil-works/pi-ai)
// ---------------------------------------------------------------------------

/**
 * Streams emit `start` first, then content events, then terminate with:
 * - `done` for success
 * - `error` for stopReason "error" | "aborted"
 */
export type AssistantMessageEvent =
  | { type: "start"; partial: AssistantMessage }
  | { type: "text_start"; contentIndex: number; partial: AssistantMessage }
  | { type: "text_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "text_end"; contentIndex: number; content: string; partial: AssistantMessage }
  | { type: "thinking_start"; contentIndex: number; partial: AssistantMessage }
  | { type: "thinking_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "thinking_end"; contentIndex: number; content: string; partial: AssistantMessage }
  | { type: "toolcall_start"; contentIndex: number; partial: AssistantMessage }
  | { type: "toolcall_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "toolcall_end"; contentIndex: number; toolCall: ToolCall; partial: AssistantMessage }
  | { type: "done"; reason: "stop" | "length" | "toolUse"; message: AssistantMessage }
  | { type: "error"; reason: "aborted" | "error"; error: AssistantMessage };

// ---------------------------------------------------------------------------
// EventStream / AssistantMessageEventStream (from @earendil-works/pi-ai/utils/event-stream)
// ---------------------------------------------------------------------------

export declare class EventStream<T, R = T> implements AsyncIterable<T> {
  push(event: T): void;
  end(result?: R): void;
  [Symbol.asyncIterator](): AsyncIterator<T>;
  result(): Promise<R>;
}

export declare class AssistantMessageEventStream extends EventStream<
  AssistantMessageEvent,
  AssistantMessage
> {}

export declare function createAssistantMessageEventStream(): AssistantMessageEventStream;

// ---------------------------------------------------------------------------
// Model / Context / SimpleStreamOptions (from @earendil-works/pi-ai)
// ---------------------------------------------------------------------------

export interface Model<TApi extends Api> {
  id: string;
  name: string;
  api: TApi;
  provider: string;
  [key: string]: unknown;
}

/** Minimal tool schema shape — enough for streamFn to pass tools through. */
export interface Tool {
  name: string;
  description?: string;
  parameters?: unknown;
  [key: string]: unknown;
}

export interface Context {
  systemPrompt?: string;
  messages: Message[];
  tools?: Tool[];
}

export interface SimpleStreamOptions {
  signal?: AbortSignal;
  temperature?: number;
  maxTokens?: number;
  reasoning?: string;
  onPayload?: (payload: unknown, model: Model<Api>) => unknown | undefined | Promise<unknown | undefined>;
  onResponse?: (response: unknown, model: Model<Api>) => void | Promise<void>;
}

// ---------------------------------------------------------------------------
// StreamFn (from @earendil-works/pi-agent-core)
// ---------------------------------------------------------------------------

/**
 * Contract (spike-verified):
 * - Must NOT throw or return a rejected promise.
 * - Must return an AssistantMessageEventStream.
 * - Failures encoded in stream: final AssistantMessage with stopReason "error"|"aborted".
 */
export type StreamFn = (
  model: Model<Api>,
  context: Context,
  options?: SimpleStreamOptions,
) => AssistantMessageEventStream | Promise<AssistantMessageEventStream>;

// ---------------------------------------------------------------------------
// AgentTool (from @earendil-works/pi-agent-core)
// ---------------------------------------------------------------------------

/** JSON Schema object shape — no typebox runtime needed; plain objects suffice. */
export type TSchema = Record<string, unknown>;

export interface AgentToolResult<TDetails = unknown> {
  content: Array<{ type: "text"; text: string }>;
  details?: TDetails;
  isError?: boolean;
}

export interface AgentTool<TParameters = unknown, TDetails = unknown> {
  name: string;
  label: string;
  description: string;
  /** JSON Schema describing the tool parameters. Plain object — no typebox dep needed. */
  parameters: TSchema;
  execute: (
    toolCallId: string,
    params: TParameters,
    signal?: AbortSignal,
  ) => Promise<AgentToolResult<TDetails>>;
}

// ---------------------------------------------------------------------------
// Agent event types (minimal subset for Phase 3)
// ---------------------------------------------------------------------------

export type AgentEventType =
  | "turn_start"
  | "turn_end"
  | "tool_execution_start"
  | "tool_execution_end"
  | "message_end";

export interface AgentEvent {
  type: AgentEventType;
  [key: string]: unknown;
}

export type AgentEventListener = (event: AgentEvent) => void;

// ---------------------------------------------------------------------------
// Agent options (from @earendil-works/pi-agent-core, minimal subset)
// ---------------------------------------------------------------------------

export interface AgentInitialState {
  systemPrompt?: string;
  model?: Model<Api>;
  tools?: AgentTool[];
  messages?: Message[];
}

export interface AgentOptions {
  streamFn: StreamFn;
  initialState?: AgentInitialState;
  maxTurns?: number;
  // beforeToolCall hook intentionally omitted: Phase 3b uses Alt B pattern
  // (execute() 内 validate + isError:true) which makes beforeToolCall redundant.
}
