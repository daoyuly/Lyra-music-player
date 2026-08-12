/**
 * companion-aux-tools.ts — Phase 3b auxiliary AgentTool definitions.
 *
 * Three read-only tools that let the LLM gather extra context before calling
 * pick_song. All three receive a ToolContext via closure — no direct repo
 * imports here (review checklist enforcement, same as companion-tools.ts).
 *
 * Tools:
 *   get_recent_plays  — last N dialogue turns (song + emotion), default 5
 *   get_soul_facts    — snapshot of soul state: mood, backbone, genres, memory
 *   get_song_features — bpm / energy / valence for up to 10 track ids
 *
 * Contract (pi tool):
 *   - execute() never throws — repo errors are caught and returned as isError:true
 *   - parameter validation errors → isError:true (pi loop retries next turn)
 *   - success → { content: [{ type: "text", text: "<JSON>" }] }
 */

import type { AgentTool, AgentToolResult } from "./pi-types.d.ts";
import type { ToolContext } from "./toolContext";

// ---------------------------------------------------------------------------
// get_recent_plays
// ---------------------------------------------------------------------------

type GetRecentPlaysParams = { n?: number };

/**
 * Read the last N dialogue turns and return their song_id + emotion snapshot.
 * LLM uses this to avoid repetition or to sense the emotional arc.
 * n: 1–20, default 5.
 */
export function makeGetRecentPlaysTool(ctx: ToolContext): AgentTool<GetRecentPlaysParams> {
  return {
    name: "get_recent_plays",
    label: "最近播放记录",
    description:
      "读取最近 N 条对话回合里播放的歌曲 id 和当时的情绪 PAD。" +
      "用来判断「是否刚才那类歌又来一首」或「避免重复」。n 默认 5，最大 20。",
    parameters: {
      type: "object",
      properties: {
        n: {
          type: "number",
          description: "要获取的最近回合数，1–20，默认 5",
        },
      },
      additionalProperties: false,
    },
    execute: async (
      _toolCallId: string,
      params: GetRecentPlaysParams,
      _signal?: AbortSignal,
    ): Promise<AgentToolResult> => {
      const n = params.n ?? 5;
      if (n < 1 || n > 20) {
        return {
          content: [{ type: "text", text: "Error: n must be between 1 and 20" }],
          isError: true,
        };
      }

      try {
        const turns = await ctx.turnRepo.listRecentTurns(Math.floor(n));
        const rows = turns.map((t) => ({
          song_id: t.agent_response.song_id,
          timestamp: t.timestamp,
          emotion: {
            pad: t.current_emotion.pad,
            labels: t.current_emotion.labels,
          },
          emotion_delta: t.emotion_delta,
        }));
        return {
          content: [{ type: "text", text: JSON.stringify(rows) }],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `Error: failed to load recent plays — ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// get_soul_facts
// ---------------------------------------------------------------------------

/**
 * Return a snapshot of the soul state: dynamic_mood, backbone, affinity_genres,
 * living_portrait (from CompanionInput — injected at call time), and shared_memory
 * top entries. Gives the LLM a "who is this person" summary.
 * No parameters.
 */
export function makeGetSoulFactsTool(ctx: ToolContext): AgentTool<Record<string, never>> {
  return {
    name: "get_soul_facts",
    label: "灵魂快照",
    description:
      "拿当前的 soul 状态快照：dynamic_mood、backbone、affinity_genres、" +
      "共同记忆最近 3 条。帮助理解「她/他是什么样的人」。无参数。",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    execute: async (
      _toolCallId: string,
      _params: Record<string, never>,
      _signal?: AbortSignal,
    ): Promise<AgentToolResult> => {
      try {
        const soul = await ctx.soulStore.load();
        const snapshot = {
          dynamic_mood: soul.dynamic_mood,
          backbone: soul.musical_taste_base.backbone,
          affinity_genres: soul.musical_taste_base.affinity_genres,
          aversion_signals: soul.musical_taste_base.aversion_signals,
          shared_memory_recent: soul.shared_memory.slice(-3).map((m) => ({
            song_id: m.song_id,
            context: m.context,
            significance: m.significance,
          })),
        };
        return {
          content: [{ type: "text", text: JSON.stringify(snapshot) }],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `Error: failed to load soul facts — ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// get_song_features
// ---------------------------------------------------------------------------

type GetSongFeaturesParams = { ids: string[] };

/**
 * Batch-fetch bpm / energy / valence for up to 10 track ids.
 * LLM uses this to verify a candidate's audio profile before committing
 * (e.g., "is this really slow enough for '接住'?").
 * ids: string[], max 10.
 */
export function makeGetSongFeaturesTool(ctx: ToolContext): AgentTool<GetSongFeaturesParams> {
  return {
    name: "get_song_features",
    label: "歌曲音频特征",
    description:
      "按 id 批量获取 bpm / energy / valence 音频特征，最多 10 个 id。" +
      "用来在调用 pick_song 之前核实候选曲目的音频 profile。",
    parameters: {
      type: "object",
      required: ["ids"],
      properties: {
        ids: {
          type: "array",
          items: { type: "string" },
          description: "要查询的歌曲 id 列表，最多 10 个",
        },
      },
      additionalProperties: false,
    },
    execute: async (
      _toolCallId: string,
      params: GetSongFeaturesParams,
      _signal?: AbortSignal,
    ): Promise<AgentToolResult> => {
      if (!Array.isArray(params.ids) || params.ids.length === 0) {
        return {
          content: [{ type: "text", text: "Error: ids must be a non-empty array" }],
          isError: true,
        };
      }
      if (params.ids.length > 10) {
        return {
          content: [{ type: "text", text: "Error: ids must contain at most 10 elements" }],
          isError: true,
        };
      }

      try {
        const featuresMap = await ctx.libraryFeaturesRepo.getBatch(params.ids);
        const result: Record<string, unknown> = {};
        for (const id of params.ids) {
          const f = featuresMap.get(id);
          result[id] = f
            ? { bpm: f.bpm, energy: f.energy, valence: f.valence }
            : null;
        }
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `Error: failed to fetch song features — ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Convenience: build all three aux tools from a ToolContext
// ---------------------------------------------------------------------------

/**
 * Returns [get_recent_plays, get_soul_facts, get_song_features] for a given ctx.
 * CompanionAgent._choosePi() spreads this into the tools array when ctx is available.
 */
export function makeAuxTools(ctx: ToolContext): AgentTool[] {
  return [
    makeGetRecentPlaysTool(ctx) as AgentTool,
    makeGetSoulFactsTool(ctx) as AgentTool,
    makeGetSongFeaturesTool(ctx) as AgentTool,
  ];
}
