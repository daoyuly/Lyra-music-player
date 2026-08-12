import { describe, it, expect, vi } from "vitest";
import { createToolContextFactory } from "./toolContextFactory";
import type { ToolContextDeps } from "./toolContextFactory";
import type { LibraryTrack, DialogueTurn } from "../types";

function makeDeps(overrides?: Partial<ToolContextDeps>): ToolContextDeps {
  const track: LibraryTrack = { id: "t1", path: "/a.mp3", origin: "local", added_at: 0 };
  return {
    libraryRepo: {
      getTrack: vi.fn(async () => track),
      listAll: vi.fn(async () => [track]),
    },
    libraryFeaturesRepo: {
      getBatch: vi.fn(async () => new Map()),
    },
    turnRepo: {
      listRecentTurns: vi.fn(async () => [] as DialogueTurn[]),
    },
    soulStore: {
      load: vi.fn(async () => ({}) as any),
    },
    clock: () => 1000,
    ...overrides,
  };
}

describe("createToolContextFactory", () => {
  it("build() returns a ToolContext that delegates libraryRepo calls", async () => {
    const deps = makeDeps();
    const factory = createToolContextFactory(deps);
    const ctx = factory.build("turn-abc");

    const result = await ctx.libraryRepo.getTrack("t1");
    expect(deps.libraryRepo.getTrack).toHaveBeenCalledWith("t1");
    expect(result).not.toBeNull();

    const all = await ctx.libraryRepo.listAll();
    expect(deps.libraryRepo.listAll).toHaveBeenCalled();
    expect(all).toHaveLength(1);
  });

  it("build() returns a ToolContext that delegates libraryFeaturesRepo and turnRepo", async () => {
    const deps = makeDeps();
    const factory = createToolContextFactory(deps);
    const ctx = factory.build("turn-xyz");

    await ctx.libraryFeaturesRepo.getBatch(["t1", "t2"]);
    expect(deps.libraryFeaturesRepo.getBatch).toHaveBeenCalledWith(["t1", "t2"]);

    await ctx.turnRepo.listRecentTurns(10);
    expect(deps.turnRepo.listRecentTurns).toHaveBeenCalledWith(10);
  });

  it("build() uses deps.clock when provided, falls back to Date.now otherwise", () => {
    const fixedClock = () => 42_000;
    const deps = makeDeps({ clock: fixedClock });
    const factory = createToolContextFactory(deps);
    const ctx = factory.build("turn-1");
    expect(ctx.clock()).toBe(42_000);

    // Without clock dep, should fall back to Date.now (a function, not 42000)
    const depsNoClock = makeDeps();
    delete (depsNoClock as any).clock;
    const ctx2 = createToolContextFactory(depsNoClock).build("turn-2");
    expect(typeof ctx2.clock()).toBe("number");
  });

  it("each build() call produces an independent ToolContext (no shared mutable state)", async () => {
    const deps = makeDeps();
    const factory = createToolContextFactory(deps);
    const ctx1 = factory.build("turn-1");
    const ctx2 = factory.build("turn-2");
    // Both delegate to the same underlying dep, but are separate objects
    expect(ctx1).not.toBe(ctx2);
    await ctx1.libraryRepo.listAll();
    await ctx2.libraryRepo.listAll();
    expect(deps.libraryRepo.listAll).toHaveBeenCalledTimes(2);
  });
});
