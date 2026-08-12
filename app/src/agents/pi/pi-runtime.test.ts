/**
 * pi-runtime.test.ts — Unit tests for the minimal Agent class (Phase 3a).
 *
 * Tests cover:
 *   - No-tool scenario: prompt → text-only assistant → agent ends
 *   - Single tool scenario: prompt → tool_call → execute → tool_result → next turn text → agent ends
 *   - max_turns hard cap: 3 turns of tool calls → agent exits without infinite loop
 *   - abort: agent.abort() stops the loop
 *   - subscribe: events are emitted in the expected order
 */

import { describe, it, expect, vi } from "vitest";
import { Agent } from "./pi-runtime";
import { makeMockProvider } from "./testing";
import { lyraStreamFn } from "./streamFn";
import type { AgentTool, AgentEvent, AgentOptions, StreamFn } from "./pi-types.d.ts";
import type { Chunk } from "../../providers/chunk";

// ---------------------------------------------------------------------------
// Helper: build a StreamFn from a sequence of Chunk arrays (one per turn)
// ---------------------------------------------------------------------------

function makeSequentialStreamFn(turns: Chunk[][]): StreamFn {
  let call = 0;
  return (model, context, opts) => {
    const chunks = turns[Math.min(call, turns.length - 1)];
    call++;
    return lyraStreamFn(makeMockProvider(chunks))(model, context, opts);
  };
}

// ---------------------------------------------------------------------------
// Helper: make a minimal AgentTool mock
// ---------------------------------------------------------------------------

function makeEchoTool(
  name: string,
  onExecute?: (params: unknown) => void,
): AgentTool {
  return {
    name,
    label: name,
    description: `Echo tool: ${name}`,
    parameters: { type: "object", properties: { value: { type: "string" } } },
    execute: vi.fn(async (_id, params) => {
      onExecute?.(params);
      return { content: [{ type: "text" as const, text: `echo:${JSON.stringify(params)}` }] };
    }),
  };
}

// ---------------------------------------------------------------------------
// 1. No-tool scenario
// ---------------------------------------------------------------------------

describe("Agent — no-tool scenario", () => {
  it("returns the assistant message when LLM emits text-only stop", async () => {
    const streamFn = makeSequentialStreamFn([
      [{ type: "text", delta: "hello world" }, { type: "stop", reason: "end" }],
    ]);
    const agent = new Agent({ streamFn });
    const result = await agent.prompt("hi");
    expect(result).not.toBeNull();
    const textBlocks = result!.content.filter((b) => b.type === "text");
    expect(textBlocks.length).toBe(1);
    expect((textBlocks[0] as { type: "text"; text: string }).text).toBe("hello world");
  });

  it("emits turn_start, message_end, turn_end events in order", async () => {
    const streamFn = makeSequentialStreamFn([
      [{ type: "text", delta: "x" }, { type: "stop", reason: "end" }],
    ]);
    const agent = new Agent({ streamFn });
    const events: string[] = [];
    agent.subscribe((e: AgentEvent) => events.push(e.type));
    await agent.prompt("hi");
    expect(events).toContain("turn_start");
    expect(events).toContain("message_end");
    expect(events).toContain("turn_end");
    expect(events.indexOf("turn_start")).toBeLessThan(events.indexOf("message_end"));
    expect(events.indexOf("message_end")).toBeLessThan(events.indexOf("turn_end"));
  });

  it("waitForIdle resolves after prompt completes", async () => {
    const streamFn = makeSequentialStreamFn([
      [{ type: "text", delta: "done" }, { type: "stop", reason: "end" }],
    ]);
    const agent = new Agent({ streamFn });
    const p = agent.prompt("go");
    const idlePromise = agent.waitForIdle();
    await p;
    await expect(idlePromise).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 2. Single tool scenario
// ---------------------------------------------------------------------------

describe("Agent — single tool scenario", () => {
  it("executes the tool and continues to the next turn", async () => {
    const executed: unknown[] = [];
    const tool = makeEchoTool("my_tool", (p) => executed.push(p));

    const streamFn = makeSequentialStreamFn([
      // Turn 1: LLM calls my_tool
      [
        { type: "tool_call", id: "tc1", name: "my_tool", argsAccum: JSON.stringify({ value: "test" }) },
        { type: "stop", reason: "tool_use" },
      ],
      // Turn 2: LLM replies with text
      [{ type: "text", delta: "done after tool" }, { type: "stop", reason: "end" }],
    ]);

    const opts: AgentOptions = { streamFn, initialState: { tools: [tool] } };
    const agent = new Agent(opts);
    const result = await agent.prompt("start");

    expect(tool.execute).toHaveBeenCalledOnce();
    expect(executed[0]).toEqual({ value: "test" });

    const textBlocks = result!.content.filter((b) => b.type === "text");
    expect((textBlocks[0] as { type: "text"; text: string }).text).toBe("done after tool");
  });

  it("emits tool_execution_start and tool_execution_end events", async () => {
    const tool = makeEchoTool("my_tool");
    const streamFn = makeSequentialStreamFn([
      [
        { type: "tool_call", id: "tc1", name: "my_tool", argsAccum: "{}" },
        { type: "stop", reason: "tool_use" },
      ],
      [{ type: "text", delta: "ok" }, { type: "stop", reason: "end" }],
    ]);

    const agent = new Agent({ streamFn, initialState: { tools: [tool] } });
    const events: AgentEvent[] = [];
    agent.subscribe((e) => events.push(e));
    await agent.prompt("go");

    const types = events.map((e) => e.type);
    expect(types).toContain("tool_execution_start");
    expect(types).toContain("tool_execution_end");
  });

  it("tool result with isError:true causes next turn to be called (retry loop)", async () => {
    let toolCallCount = 0;
    const tool: AgentTool = {
      name: "bad_tool",
      label: "bad",
      description: "sometimes fails",
      parameters: { type: "object", properties: {} },
      execute: vi.fn(async () => {
        toolCallCount++;
        if (toolCallCount === 1) {
          return {
            content: [{ type: "text" as const, text: "Error: bad id" }],
            isError: true,
          };
        }
        return { content: [{ type: "text" as const, text: "ok" }] };
      }),
    };

    // 3 turns of tool_call, then turn 3 shows the loop ends at maxTurns
    const streamFn = makeSequentialStreamFn([
      [{ type: "tool_call", id: "tc1", name: "bad_tool", argsAccum: "{}" }, { type: "stop", reason: "tool_use" }],
      [{ type: "tool_call", id: "tc2", name: "bad_tool", argsAccum: "{}" }, { type: "stop", reason: "tool_use" }],
      [{ type: "text", delta: "finally done" }, { type: "stop", reason: "end" }],
    ]);

    const agent = new Agent({ streamFn, initialState: { tools: [tool] }, maxTurns: 3 });
    await agent.prompt("go");

    // Tool executed on turns 1 and 2; turn 3 had no tool call
    expect(toolCallCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 3. max_turns hard cap
// ---------------------------------------------------------------------------

describe("Agent — max_turns hard cap", () => {
  it("stops after maxTurns even if LLM keeps calling tools", async () => {
    const tool = makeEchoTool("loop_tool");

    let streamCallCount = 0;
    const streamFn: StreamFn = (model, context, opts) => {
      streamCallCount++;
      return lyraStreamFn(makeMockProvider([
        { type: "tool_call", id: `tc${streamCallCount}`, name: "loop_tool", argsAccum: "{}" },
        { type: "stop", reason: "tool_use" },
      ]))(model, context, opts);
    };

    const agent = new Agent({ streamFn, initialState: { tools: [tool] }, maxTurns: 3 });
    const result = await agent.prompt("go");

    expect(streamCallCount).toBe(3);
    expect(result).not.toBeNull();
  });

  it("defaults to maxTurns=3 when not specified", async () => {
    const tool = makeEchoTool("inf_tool");
    let streamCallCount = 0;
    const streamFn: StreamFn = (model, context, opts) => {
      streamCallCount++;
      return lyraStreamFn(makeMockProvider([
        { type: "tool_call", id: `tc${streamCallCount}`, name: "inf_tool", argsAccum: "{}" },
        { type: "stop", reason: "tool_use" },
      ]))(model, context, opts);
    };

    const agent = new Agent({ streamFn, initialState: { tools: [tool] } });
    await agent.prompt("go");
    expect(streamCallCount).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// 4. Abort
// ---------------------------------------------------------------------------

describe("Agent — abort", () => {
  it("abort() during prompt causes the run to stop without hanging", async () => {
    // Agent creates a fresh AbortController on each prompt() call.
    // To test abort mid-run: call abort() from inside streamFn.
    const agent = new Agent({
      streamFn: (model, context, opts) => {
        // Abort the agent from within the stream callback
        agent.abort();
        return lyraStreamFn(makeMockProvider([
          { type: "stop", reason: "aborted" },
        ]))(model, context, opts);
      },
    });

    const result = await agent.prompt("go");
    // Should complete (not hang) regardless of whether result is null or partial
    await expect(agent.waitForIdle()).resolves.toBeUndefined();
    void result;
  });

  it("subscribe unsubscribe stops receiving events", async () => {
    const streamFn = makeSequentialStreamFn([
      [{ type: "text", delta: "hi" }, { type: "stop", reason: "end" }],
    ]);
    const agent = new Agent({ streamFn });
    const received: string[] = [];
    const unsub = agent.subscribe((e) => received.push(e.type));
    unsub(); // unsubscribe before prompt
    await agent.prompt("x");
    expect(received).toHaveLength(0);
  });
});
