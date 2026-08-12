/**
 * pi-runtime.ts — runtime shim for @earendil-works/pi-ai factory functions.
 *
 * This module is the ONLY place in Phase 1 where pi-ai runtime code is
 * referenced. All other files use `import type` and never touch this module.
 *
 * In Phase 1 (no real package), we provide a minimal in-process
 * implementation of createAssistantMessageEventStream() that matches the
 * real contract exactly. Phase 2 replaces this file's body with:
 *
 *   export { createAssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";
 *
 * and deletes pi-types.d.ts.
 *
 * Implementation follows the real EventStream contract from the spike:
 *   class EventStream<T, R> implements AsyncIterable<T>
 *     push(event: T): void
 *     end(result?: R): void
 *     result(): Promise<R>
 */

import type {
  AssistantMessage,
  AssistantMessageEvent,
  AssistantMessageEventStream,
  AgentOptions,
  AgentEvent,
  AgentEventListener,
  AgentTool,
  Message,
  ToolCall,
  ToolResultMessage,
  Model,
  Api,
} from "./pi-types.d.ts";

// ---------------------------------------------------------------------------
// Minimal EventStream implementation
// ---------------------------------------------------------------------------

class EventStreamImpl<T, R = T> implements AsyncIterable<T> {
  private readonly queue: T[] = [];
  private readonly waiting: Array<(value: IteratorResult<T>) => void> = [];
  private isDone = false;
  private finalResult: R | undefined;
  private resolveFinalResult!: (r: R) => void;
  private readonly finalResultPromise: Promise<R>;

  constructor(
    private readonly isComplete: (event: T) => boolean,
    private readonly extractResult: (event: T) => R,
  ) {
    this.finalResultPromise = new Promise<R>((res) => {
      this.resolveFinalResult = res;
    });
  }

  push(event: T): void {
    if (this.isDone) return;
    if (this.waiting.length > 0) {
      const resolve = this.waiting.shift()!;
      resolve({ value: event, done: false });
    } else {
      this.queue.push(event);
    }
    if (this.isComplete(event)) {
      this.finalResult = this.extractResult(event);
      this.resolveFinalResult(this.finalResult);
      this.isDone = true;
      // Drain remaining waiters
      for (const resolve of this.waiting) {
        resolve({ value: undefined as unknown as T, done: true });
      }
      this.waiting.length = 0;
    }
  }

  end(result?: R): void {
    if (this.isDone) return;
    this.isDone = true;
    if (result !== undefined) {
      this.resolveFinalResult(result);
    }
    for (const resolve of this.waiting) {
      resolve({ value: undefined as unknown as T, done: true });
    }
    this.waiting.length = 0;
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    let queueIndex = 0;
    return {
      next: (): Promise<IteratorResult<T>> => {
        // Drain queue first
        if (queueIndex < this.queue.length) {
          return Promise.resolve({ value: this.queue[queueIndex++], done: false });
        }
        if (this.isDone) {
          return Promise.resolve({ value: undefined as unknown as T, done: true });
        }
        // Wait for next push / end
        return new Promise<IteratorResult<T>>((resolve) => {
          this.waiting.push(resolve);
        });
      },
    };
  }

  result(): Promise<R> {
    return this.finalResultPromise;
  }
}

// ---------------------------------------------------------------------------
// AssistantMessageEventStream concrete class
// ---------------------------------------------------------------------------

class AssistantMessageEventStreamImpl
  extends EventStreamImpl<AssistantMessageEvent, AssistantMessage>
  implements AssistantMessageEventStream
{
  constructor() {
    super(
      (event) => event.type === "done" || event.type === "error",
      (event) => {
        if (event.type === "done") return event.message;
        if (event.type === "error") return event.error;
        // unreachable — isComplete guards this
        throw new Error("unexpected terminal event");
      },
    );
  }
}

/**
 * Factory for AssistantMessageEventStream (matches real pi-ai API).
 *
 * Phase 2 migration: replace this export with the real factory from pi-ai.
 */
export function createAssistantMessageEventStream(): AssistantMessageEventStream {
  return new AssistantMessageEventStreamImpl();
}

// ---------------------------------------------------------------------------
// Minimal Agent class — Phase 3a (tool loop, abort, subscribe, waitForIdle)
//
// Stripped from @earendil-works/pi-agent-core v0.83.0 agent.js:
//   - No session persistence / memory backend
//   - No steering / follow-up queue
//   - No transformContext / prepareArguments shim
//   - No ThinkingBudgets / transport differentiation
//   - No QueueMode complexity
// Kept: core tool loop, AbortSignal, event subscribe, prompt/abort/waitForIdle
//
// Hard cap: max_turns=3 (configurable via AgentOptions.maxTurns).
// Line count is tracked — must stay ≤ 250 total for this file.
// ---------------------------------------------------------------------------

const COMPANION_PI_MODEL: Model<Api> = {
  id: "lyra-companion",
  name: "Lyra Companion",
  api: "openai" as Api,
  provider: "lyra",
};

export class Agent {
  private opts: AgentOptions;
  private listeners: Set<AgentEventListener> = new Set();
  private abortController: AbortController = new AbortController();
  private idleResolvers: Array<() => void> = [];
  private running = false;

  constructor(opts: AgentOptions) {
    this.opts = opts;
  }

  /** Subscribe to agent lifecycle events. Returns unsubscribe function. */
  subscribe(listener: AgentEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Abort the current agent run. Safe to call multiple times. */
  abort(): void {
    this.abortController.abort();
  }

  /** Resolves when the agent is no longer running. */
  waitForIdle(): Promise<void> {
    if (!this.running) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.idleResolvers.push(resolve);
    });
  }

  /**
   * Send a user message and run the agent loop until stop or max_turns.
   * If text is empty, the loop runs from the messages already in initialState.
   */
  async prompt(text: string): Promise<AssistantMessage | null> {
    this.running = true;
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    const { streamFn, initialState, maxTurns = 3 } = this.opts;
    const tools: AgentTool[] = initialState?.tools ?? [];
    const toolMap = new Map<string, AgentTool>(tools.map((t) => [t.name, t]));

    // Build working message list
    const messages: Message[] = [...(initialState?.messages ?? [])];
    if (text) {
      messages.push({ role: "user", content: text, timestamp: Date.now() });
    }

    const model = initialState?.model ?? COMPANION_PI_MODEL;
    let lastAssistant: AssistantMessage | null = null;

    try {
      for (let turn = 0; turn < maxTurns; turn++) {
        if (signal.aborted) break;

        this.emit({ type: "turn_start", turn });

        const context = {
          systemPrompt: initialState?.systemPrompt,
          messages: [...messages],
          tools: tools.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          })),
        };

        const stream = await streamFn(model, context, { signal });
        const assistantMsg = await stream.result();
        lastAssistant = assistantMsg;

        messages.push(assistantMsg);
        this.emit({ type: "message_end", message: assistantMsg });
        this.emit({ type: "turn_end", turn, message: assistantMsg });

        // Collect tool calls from this assistant message
        const toolCalls = assistantMsg.content.filter(
          (b): b is ToolCall => b.type === "toolCall",
        );

        if (toolCalls.length === 0) {
          // No tool calls — agent is done
          break;
        }

        // Execute tools sequentially and collect results
        const toolResults: ToolResultMessage[] = [];
        for (const tc of toolCalls) {
          if (signal.aborted) break;
          this.emit({ type: "tool_execution_start", toolCallId: tc.id, toolName: tc.name });

          const tool = toolMap.get(tc.name);
          let result: { content: Array<{ type: "text"; text: string }>; isError?: boolean };
          if (!tool) {
            result = {
              content: [{ type: "text", text: `Unknown tool: ${tc.name}` }],
              isError: true,
            };
          } else {
            try {
              result = await tool.execute(tc.id, tc.arguments as never, signal);
            } catch (err) {
              result = {
                content: [{ type: "text", text: String(err) }],
                isError: true,
              };
            }
          }

          this.emit({ type: "tool_execution_end", toolCallId: tc.id, toolName: tc.name, result });

          toolResults.push({
            role: "toolResult",
            toolCallId: tc.id,
            toolName: tc.name,
            content: result.content,
            isError: result.isError ?? false,
            timestamp: Date.now(),
          });
        }

        // Inject tool results for the next turn
        for (const tr of toolResults) {
          messages.push(tr);
        }
      }
    } finally {
      this.running = false;
      for (const resolve of this.idleResolvers) resolve();
      this.idleResolvers = [];
    }

    return lastAssistant;
  }

  private emit(event: AgentEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // listeners must not crash the agent loop
      }
    }
  }
}
