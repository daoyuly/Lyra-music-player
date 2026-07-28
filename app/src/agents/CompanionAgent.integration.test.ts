/**
 * CompanionAgent Sprint 14 integration tests
 *
 * End-to-end validation of the recommendation engine:
 * - Shift inference from behavioral signals
 * - Candidate re-ranking by shift affinity
 * - Emotion timeline context inclusion
 * - Cross-shift ordering consistency
 */

import { describe, it, expect, vi } from "vitest";
import { CompanionAgent } from "./CompanionAgent";
import type {
  ModelProvider,
  ChatMessage,
  ChatResponse,
  SoulState,
  CurrentEmotion,
  LibraryTrack,
} from "../types";
import type { CompanionInput } from "./types";

// Helpers
function makeSoul(): SoulState {
  return {
    agent_id: "lyra_001",
    created_at: "2026-07-06",
    musical_taste_base: {
      aesthetic_axes: {
        restraint_vs_expression: 0.5,
        narrative_vs_atmospheric: 0.5,
        polished_vs_raw: 0,
        novelty_seeking: 0.5,
      },
      affinity_genres: ["indie"],
      aversion_signals: [],
      backbone: "有品味的朋友",
    },
    dynamic_mood: { current_pad: { p: 0, a: 0, d: 0 }, attention_to_user: 0.85, recent_bias: "" },
    shared_memory: [],
    evolution_log: [],
    proactive_budget: {
      daily_limit: 3,
      sulk_until: null,
      kind_budgets: { morning: 1, care: 1, anniversary: 1, share: 1, rhythm: 2 },
    },
  };
}

function makeTrack(
  id: string,
  bpm: number,
  mood: string,
  genre: string = "pop",
): LibraryTrack {
  return {
    id,
    path: `/music/${id}.mp3`,
    origin: "local",
    title: `Song ${id}`,
    added_at: 0,
    metadata: { bpm, mood, genre },
  };
}

function captureBriefStub(responseId: string) {
  const capturedMessages: ChatMessage[][] = [];
  const provider: ModelProvider = {
    id: "anthropic",
    chat: vi.fn(async (msgs: ChatMessage[]) => {
      capturedMessages.push(msgs);
      return {
        content: JSON.stringify({
          song_id: responseId,
          target_profile: "test target",
          rationale: "test reason",
          needed_shift: "陪着",
        }),
      } as ChatResponse;
    }),
  };
  return { provider, capturedMessages };
}

describe("CompanionAgent Sprint 14 integration", () => {
  describe("shift inference in brief", () => {
    it("includes '接住' recommendation when user is low arousal + offline + hesitant", async () => {
      const { provider, capturedMessages } = captureBriefStub("slow-1");
      const agent = new CompanionAgent({ provider });

      const emotion: CurrentEmotion = {
        pad: { p: 0, a: -0.5, d: 0 },
        labels: ["低落"],
        confidence: 0.7,
        source: "emotion-agent-inferred",
      };

      const input: CompanionInput = {
        userUtterance: "",
        currentEmotion: emotion,
        soul: makeSoul(),
        candidates: [makeTrack("slow-1", 60, "calm", "piano")],
        isBlurred: true,
        inputHesitation: "many",
      };

      await agent.choose(input);

      const brief = capturedMessages[0][1].content;
      expect(brief).toContain("接住");
      expect(brief).toContain("推荐的转变方向");
    });

    it("includes '点燃' recommendation when user has low arousal + high skip ratio", async () => {
      const { provider, capturedMessages } = captureBriefStub("fast-1");
      const agent = new CompanionAgent({ provider });

      const emotion: CurrentEmotion = {
        pad: { p: -0.2, a: -0.2, d: 0 },
        labels: [],
        confidence: 0.5,
        source: "emotion-agent-inferred",
      };

      const input: CompanionInput = {
        userUtterance: "",
        currentEmotion: emotion,
        soul: makeSoul(),
        candidates: [makeTrack("fast-1", 140, "energetic", "rock")],
        skipRatio: 0.7,
      };

      await agent.choose(input);

      const brief = capturedMessages[0][1].content;
      expect(brief).toContain("点燃");
    });

    it("defaults to '陪着' with no strong signals", async () => {
      const { provider, capturedMessages } = captureBriefStub("mid-1");
      const agent = new CompanionAgent({ provider });

      const emotion: CurrentEmotion = {
        pad: { p: 0, a: 0.1, d: 0 },
        labels: [],
        confidence: 0.3,
        source: "emotion-agent-inferred",
      };

      const input: CompanionInput = {
        userUtterance: "",
        currentEmotion: emotion,
        soul: makeSoul(),
        candidates: [makeTrack("mid-1", 110, "neutral", "indie")],
      };

      await agent.choose(input);

      const brief = capturedMessages[0][1].content;
      expect(brief).toContain("陪着");
    });
  });

  describe("candidate re-ranking", () => {
    it("re-ranks candidates by shift affinity for '接住' scenario", async () => {
      const { provider, capturedMessages } = captureBriefStub("slow-1");
      const agent = new CompanionAgent({ provider });

      const emotion: CurrentEmotion = {
        pad: { p: 0, a: -0.5, d: 0 },
        labels: [],
        confidence: 0.7,
        source: "emotion-agent-inferred",
      };

      // Provide slow + fast tracks in mixed order
      const candidates = [
        makeTrack("fast-1", 150, "energetic", "rock"),
        makeTrack("slow-1", 60, "calm", "piano"),
        makeTrack("medium-1", 110, "neutral", "indie"),
      ];

      const input: CompanionInput = {
        userUtterance: "",
        currentEmotion: emotion,
        soul: makeSoul(),
        candidates,
        isBlurred: true,
        inputHesitation: "many",
      };

      await agent.choose(input);

      const brief = capturedMessages[0][1].content;
      // In the ranked candidate block, slow-1 should appear before fast-1
      const slowPos = brief.indexOf("id=slow-1");
      const fastPos = brief.indexOf("id=fast-1");
      expect(slowPos).toBeGreaterThan(0);
      expect(fastPos).toBeGreaterThan(0);
      expect(slowPos).toBeLessThan(fastPos); // slow first
    });

    it("re-ranks candidates by shift affinity for '点燃' scenario", async () => {
      const { provider, capturedMessages } = captureBriefStub("fast-1");
      const agent = new CompanionAgent({ provider });

      const emotion: CurrentEmotion = {
        pad: { p: -0.3, a: -0.2, d: 0 },
        labels: [],
        confidence: 0.5,
        source: "emotion-agent-inferred",
      };

      const candidates = [
        makeTrack("slow-1", 60, "calm", "piano"),
        makeTrack("fast-1", 150, "energetic", "rock"),
        makeTrack("medium-1", 110, "neutral", "indie"),
      ];

      const input: CompanionInput = {
        userUtterance: "",
        currentEmotion: emotion,
        soul: makeSoul(),
        candidates,
        skipRatio: 0.7, // Triggers 点燃
      };

      await agent.choose(input);

      const brief = capturedMessages[0][1].content;
      const fastPos = brief.indexOf("id=fast-1");
      const slowPos = brief.indexOf("id=slow-1");
      expect(fastPos).toBeGreaterThan(0);
      expect(fastPos).toBeLessThan(slowPos); // fast first for 点燃
    });

    it("preserves all candidates in the ranked output", async () => {
      const { provider, capturedMessages } = captureBriefStub("t1");
      const agent = new CompanionAgent({ provider });

      const candidates = [
        makeTrack("t1", 60, "calm"),
        makeTrack("t2", 90, "neutral"),
        makeTrack("t3", 140, "energetic"),
      ];

      const input: CompanionInput = {
        userUtterance: "",
        currentEmotion: {
          pad: { p: 0, a: 0, d: 0 },
          labels: [],
          confidence: 0.3,
          source: "emotion-agent-inferred",
        },
        soul: makeSoul(),
        candidates,
      };

      await agent.choose(input);

      const brief = capturedMessages[0][1].content;
      expect(brief).toContain("id=t1");
      expect(brief).toContain("id=t2");
      expect(brief).toContain("id=t3");
    });
  });

  describe("emotion timeline integration", () => {
    it("includes long-term emotion arc when provided", async () => {
      const { provider, capturedMessages } = captureBriefStub("t1");
      const agent = new CompanionAgent({ provider });

      const input: CompanionInput = {
        userUtterance: "",
        currentEmotion: {
          pad: { p: 0, a: 0, d: 0 },
          labels: [],
          confidence: 0.5,
          source: "emotion-agent-inferred",
        },
        soul: makeSoul(),
        candidates: [makeTrack("t1", 100, "neutral")],
        emotionTimelineSummary: "7d 窗口 (12 样本): 平均 PAD=(p=-0.15, a=0.05, d=0.00) · 愉悦度: improving · 兴奋度: stable",
      };

      await agent.choose(input);

      const brief = capturedMessages[0][1].content;
      expect(brief).toContain("长期情感轨迹");
      expect(brief).toContain("improving");
      expect(brief).toContain("7d 窗口");
    });

    it("omits emotion arc when not provided", async () => {
      const { provider, capturedMessages } = captureBriefStub("t1");
      const agent = new CompanionAgent({ provider });

      const input: CompanionInput = {
        userUtterance: "",
        currentEmotion: {
          pad: { p: 0, a: 0, d: 0 },
          labels: [],
          confidence: 0.5,
          source: "emotion-agent-inferred",
        },
        soul: makeSoul(),
        candidates: [makeTrack("t1", 100, "neutral")],
      };

      await agent.choose(input);

      const brief = capturedMessages[0][1].content;
      expect(brief).not.toContain("长期情感轨迹");
    });
  });

  describe("cross-shift consistency", () => {
    it("same candidates rank differently for different shifts", async () => {
      const candidates = [
        makeTrack("slow", 60, "calm", "piano"),
        makeTrack("fast", 150, "energetic", "rock"),
        makeTrack("mid", 110, "neutral", "indie"),
      ];

      // Scenario 1: 接住 shift
      const s1 = captureBriefStub("slow");
      const agent1 = new CompanionAgent({ provider: s1.provider });
      await agent1.choose({
        userUtterance: "",
        currentEmotion: {
          pad: { p: 0, a: -0.5, d: 0 },
          labels: [],
          confidence: 0.7,
          source: "emotion-agent-inferred",
        },
        soul: makeSoul(),
        candidates,
        isBlurred: true,
        inputHesitation: "many",
      });

      // Scenario 2: 点燃 shift
      const s2 = captureBriefStub("fast");
      const agent2 = new CompanionAgent({ provider: s2.provider });
      await agent2.choose({
        userUtterance: "",
        currentEmotion: {
          pad: { p: -0.3, a: -0.2, d: 0 },
          labels: [],
          confidence: 0.5,
          source: "emotion-agent-inferred",
        },
        soul: makeSoul(),
        candidates,
        skipRatio: 0.7,
      });

      const brief1 = s1.capturedMessages[0][1].content;
      const brief2 = s2.capturedMessages[0][1].content;

      // 接住: slow first
      const slowPos1 = brief1.indexOf("id=slow");
      const fastPos1 = brief1.indexOf("id=fast");
      expect(slowPos1).toBeLessThan(fastPos1);

      // 点燃: fast first
      const slowPos2 = brief2.indexOf("id=slow");
      const fastPos2 = brief2.indexOf("id=fast");
      expect(fastPos2).toBeLessThan(slowPos2);

      // Confirm the rankings are opposite between scenarios
      expect(slowPos1 < fastPos1).not.toBe(slowPos2 < fastPos2);
    });
  });

  describe("backward compatibility", () => {
    it("works without any Sprint 14 fields (baseline behavior)", async () => {
      const { provider } = captureBriefStub("t1");
      const agent = new CompanionAgent({ provider });

      const input: CompanionInput = {
        userUtterance: "hello",
        currentEmotion: {
          pad: { p: 0, a: 0, d: 0 },
          labels: [],
          confidence: 0.5,
          source: "emotion-agent-inferred",
        },
        soul: makeSoul(),
        candidates: [makeTrack("t1", 100, "neutral")],
        // No skipRatio, isBlurred, inputHesitation, emotionTimelineSummary
      };

      const result = await agent.choose(input);
      expect(result.song_id).toBe("t1");
    });
  });
});
