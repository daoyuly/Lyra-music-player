/**
 * streamFn.ts — lyraStreamFn adapter (Phase 1 sub-thread B)
 *
 * Bridges Lyra's provider.chatStream (→ AsyncIterable<Chunk>) to the pi
 * StreamFn contract (→ AssistantMessageEventStream).
 *
 * Contract (spike-verified, 2026-08-03):
 * - Must NOT throw. All failures are encoded in the stream.
 * - AbortSignal from options is threaded through to provider.chatStream.
 * - Final AssistantMessage stopReason is one of: "stop" | "toolUse" | "error" | "aborted".
 *
 * Tool schema support:
 * - OpenAI-compat format (DeepSeek / Zhipu): passed through as-is.
 * - Anthropic format: converted inside anthropic.ts's chatStream via
 *   toAnthropicTools() at the provider boundary; agent layer stays
 *   OpenAI-compat as the "wire format".
 *
 * When a future phase adds @earendil-works/pi-ai to package.json, replace
 * the import path below with the real module and delete pi-types.d.ts.
 */

// Runtime-only import: the factory function that creates the stream object.
// All other pi types are imported as `type` and stripped at compile time.
import { createAssistantMessageEventStream } from "./pi-runtime";

import type {
  Api,
  AssistantMessage,
  AssistantMessageEvent,
  AssistantMessageEventStream,
  Context,
  Model,
  SimpleStreamOptions,
  StreamFn,
  ToolCall,
} from "./pi-types.d.ts";

import type { Chunk, ChatStreamOptions } from "../../providers/chunk";
import type { ChatMessage } from "../../types";

// ---------------------------------------------------------------------------
// Provider interface — sub-thread A defines the full class; we use a minimal
// structural type so this file does not have a hard dep on any provider impl.
// ---------------------------------------------------------------------------

export interface StreamableProvider {
  chatStream(
    messages: ChatMessage[],
    opts: ChatStreamOptions,
    signal?: AbortSignal,
  ): AsyncIterable<Chunk>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build the minimal zero-usage object required by AssistantMessage. */
function zeroUsage(): AssistantMessage["usage"] {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

/**
 * Construct a skeletal AssistantMessage for use as a partial/final message
 * within the stream.
 */
function makeMessage(
  model: Model<Api>,
  overrides: Partial<AssistantMessage> = {},
): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: zeroUsage(),
    stopReason: "pending",
    timestamp: Date.now(),
    ...overrides,
  };
}

/**
 * Convert pi Context.messages (pi Message[]) to the flat ChatMessage[] that
 * Lyra providers expect (only role + content string).
 *
 * Filtering rules:
 * - toolResult messages are dropped — Lyra providers don't understand them yet.
 * - assistant content arrays are joined to a single string.
 * - thinking content blocks are omitted (providers don't consume them).
 */
function convertMessages(piMessages: Context["messages"]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const msg of piMessages) {
    if (msg.role === "user") {
      const content =
        typeof msg.content === "string"
          ? msg.content
          : msg.content
              .filter((b) => b.type === "text")
              .map((b) => (b as { type: "text"; text: string }).text)
              .join("");
      out.push({ role: "user", content });
    } else if (msg.role === "assistant") {
      const content = msg.content
        .filter((b) => b.type === "text")
        .map((b) => (b as { type: "text"; text: string }).text)
        .join("");
      if (content) out.push({ role: "assistant", content });
    }
    // toolResult: not forwarded — Lyra providers don't have tool result turns yet
  }
  return out;
}

/**
 * Convert pi Context tools to the pass-through format that ChatStreamOptions
 * accepts. Agent layer emits OpenAI-compat format uniformly.
 * Provider-specific translation happens at the provider boundary (see
 * anthropic.ts:toAnthropicTools for the Anthropic conversion).
 */
function convertTools(context: Context): unknown[] | undefined {
  if (!context.tools || context.tools.length === 0) return undefined;
  return context.tools as unknown[];
}

// ---------------------------------------------------------------------------
// Main adapter
// ---------------------------------------------------------------------------

/**
 * lyraStreamFn — wraps a StreamableProvider so it satisfies the pi StreamFn
 * contract.
 *
 * Usage:
 *   const agent = new Agent({ streamFn: lyraStreamFn(provider), ... });
 */
export function lyraStreamFn(provider: StreamableProvider): StreamFn {
  return async (
    model: Model<Api>,
    context: Context,
    options?: SimpleStreamOptions,
  ): Promise<AssistantMessageEventStream> => {
    const stream = createAssistantMessageEventStream();

    // Run the streaming in a detached async IIFE so we can return the stream
    // object immediately (per contract: return before stream is complete).
    void (async () => {
      const partial = makeMessage(model, { stopReason: "pending" });

      try {
        // Emit "start" event
        const startEvent: AssistantMessageEvent = { type: "start", partial: { ...partial } };
        stream.push(startEvent);

        const messages = convertMessages(context.messages);
        const tools = convertTools(context);

        const chatOpts: ChatStreamOptions = {
          tools,
        };

        let textAccum = "";
        let textContentIndex = 0;
        let textBlockOpen = false;

        // Track tool calls by id → { index, name, argsAccum }
        const toolCallMap = new Map<
          string,
          { contentIndex: number; name: string; argsAccum: string }
        >();
        let nextContentIndex = 0;

        const chunkIter = provider.chatStream(messages, chatOpts, options?.signal);

        for await (const chunk of chunkIter) {
          // Check abort between chunks
          if (options?.signal?.aborted) {
            if (textBlockOpen) {
              stream.push({
                type: "text_end",
                contentIndex: textContentIndex,
                content: textAccum,
                partial: { ...partial },
              });
              textBlockOpen = false;
            }
            const abortedMsg = makeMessage(model, {
              content: textAccum
                ? [{ type: "text", text: textAccum }]
                : [],
              stopReason: "aborted",
              errorMessage: "Aborted by caller signal",
              timestamp: Date.now(),
            });
            stream.push({
              type: "error",
              reason: "aborted",
              error: abortedMsg,
            });
            stream.end(abortedMsg);
            return;
          }

          switch (chunk.type) {
            case "text": {
              if (!textBlockOpen) {
                textContentIndex = nextContentIndex++;
                textBlockOpen = true;
                stream.push({
                  type: "text_start",
                  contentIndex: textContentIndex,
                  partial: { ...partial },
                });
              }
              textAccum += chunk.delta;
              // Update partial content
              partial.content = [{ type: "text", text: textAccum }];
              stream.push({
                type: "text_delta",
                contentIndex: textContentIndex,
                delta: chunk.delta,
                partial: { ...partial },
              });
              break;
            }

            case "tool_call": {
              // Close any open text block
              if (textBlockOpen) {
                stream.push({
                  type: "text_end",
                  contentIndex: textContentIndex,
                  content: textAccum,
                  partial: { ...partial },
                });
                textBlockOpen = false;
              }

              if (!toolCallMap.has(chunk.id)) {
                const contentIndex = nextContentIndex++;
                toolCallMap.set(chunk.id, {
                  contentIndex,
                  name: chunk.name ?? "",
                  argsAccum: "",
                });
                stream.push({
                  type: "toolcall_start",
                  contentIndex,
                  partial: { ...partial },
                });
              }

              const tc = toolCallMap.get(chunk.id)!;
              if (chunk.name) tc.name = chunk.name;

              const delta = chunk.argsDelta ?? chunk.argsAccum ?? "";
              if (delta) {
                tc.argsAccum += delta;
                stream.push({
                  type: "toolcall_delta",
                  contentIndex: tc.contentIndex,
                  delta,
                  partial: { ...partial },
                });
              }
              break;
            }

            case "warning": {
              // Forward as text — pi has no dedicated warning event type
              if (!textBlockOpen) {
                textContentIndex = nextContentIndex++;
                textBlockOpen = true;
                stream.push({
                  type: "text_start",
                  contentIndex: textContentIndex,
                  partial: { ...partial },
                });
              }
              const warningText = `[warning: ${chunk.message}]`;
              textAccum += warningText;
              partial.content = [{ type: "text", text: textAccum }];
              stream.push({
                type: "text_delta",
                contentIndex: textContentIndex,
                delta: warningText,
                partial: { ...partial },
              });
              break;
            }

            case "error": {
              // Error chunk: close open blocks and emit error terminal event
              if (textBlockOpen) {
                stream.push({
                  type: "text_end",
                  contentIndex: textContentIndex,
                  content: textAccum,
                  partial: { ...partial },
                });
                textBlockOpen = false;
              }
              const errMsg = makeMessage(model, {
                content: textAccum ? [{ type: "text", text: textAccum }] : [],
                stopReason: "error",
                errorMessage: chunk.message,
                timestamp: Date.now(),
              });
              stream.push({ type: "error", reason: "error", error: errMsg });
              stream.end(errMsg);
              return;
            }

            case "stop": {
              // Close open blocks before emitting the terminal event
              if (textBlockOpen) {
                stream.push({
                  type: "text_end",
                  contentIndex: textContentIndex,
                  content: textAccum,
                  partial: { ...partial },
                });
                textBlockOpen = false;
              }

              // Finalise any open tool call blocks
              const finalToolCalls: ToolCall[] = [];
              for (const [id, tc] of toolCallMap) {
                let parsedArgs: Record<string, unknown> = {};
                try {
                  parsedArgs = tc.argsAccum ? (JSON.parse(tc.argsAccum) as Record<string, unknown>) : {};
                } catch {
                  parsedArgs = {};
                }
                const toolCall: ToolCall = {
                  type: "toolCall",
                  id,
                  name: tc.name,
                  arguments: parsedArgs,
                };
                stream.push({
                  type: "toolcall_end",
                  contentIndex: tc.contentIndex,
                  toolCall,
                  partial: { ...partial },
                });
                finalToolCalls.push(toolCall);
              }

              if (chunk.reason === "aborted") {
                const abortedMsg = makeMessage(model, {
                  content: [
                    ...(textAccum ? [{ type: "text" as const, text: textAccum }] : []),
                    ...finalToolCalls,
                  ],
                  stopReason: "aborted",
                  errorMessage: "Aborted",
                  timestamp: Date.now(),
                });
                stream.push({ type: "error", reason: "aborted", error: abortedMsg });
                stream.end(abortedMsg);
              } else if (chunk.reason === "error") {
                const errMsg = makeMessage(model, {
                  content: textAccum ? [{ type: "text", text: textAccum }] : [],
                  stopReason: "error",
                  errorMessage: "Provider error",
                  timestamp: Date.now(),
                });
                stream.push({ type: "error", reason: "error", error: errMsg });
                stream.end(errMsg);
              } else {
                // "end" or "tool_use"
                const doneReason =
                  chunk.reason === "tool_use" ? "toolUse" : "stop";
                const doneMsg = makeMessage(model, {
                  content: [
                    ...(textAccum ? [{ type: "text" as const, text: textAccum }] : []),
                    ...finalToolCalls,
                  ],
                  stopReason: doneReason,
                  timestamp: Date.now(),
                });
                stream.push({ type: "done", reason: doneReason, message: doneMsg });
                stream.end(doneMsg);
              }
              return;
            }
          }
        }

        // If the chunk iterator completes without a stop chunk, emit a done
        if (textBlockOpen) {
          stream.push({
            type: "text_end",
            contentIndex: textContentIndex,
            content: textAccum,
            partial: { ...partial },
          });
        }
        const finalContent: AssistantMessage["content"] = [
          ...(textAccum ? [{ type: "text" as const, text: textAccum }] : []),
        ];
        for (const [id, tc] of toolCallMap) {
          let parsedArgs: Record<string, unknown> = {};
          try {
            parsedArgs = tc.argsAccum ? (JSON.parse(tc.argsAccum) as Record<string, unknown>) : {};
          } catch {
            parsedArgs = {};
          }
          finalContent.push({
            type: "toolCall",
            id,
            name: tc.name,
            arguments: parsedArgs,
          });
        }
        const doneMsg = makeMessage(model, {
          content: finalContent,
          stopReason: "stop",
          timestamp: Date.now(),
        });
        stream.push({ type: "done", reason: "stop", message: doneMsg });
        stream.end(doneMsg);
      } catch (err: unknown) {
        // Contract: must not throw. Encode any unexpected error in the stream.
        const message =
          err instanceof Error ? err.message : String(err);
        const errMsg = makeMessage(model, {
          stopReason: "error",
          errorMessage: message,
          timestamp: Date.now(),
        });
        try {
          stream.push({ type: "error", reason: "error", error: errMsg });
          stream.end(errMsg);
        } catch {
          // Stream already ended — nothing we can do.
        }
      }
    })();

    return stream;
  };
}
