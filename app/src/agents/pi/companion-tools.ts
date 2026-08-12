/**
 * companion-tools.ts — pi AgentTool definitions for CompanionAgent (Phase 3a).
 *
 * Exports a single factory `makePickSongTool` that creates the `pick_song`
 * AgentTool used in the pi path of CompanionAgent._choosePi().
 *
 * Design: Alt B pattern (spike companion-thin-spike-report.md):
 *   - schema is relaxed (string fields only, no dynamic enum for song_id)
 *   - execute() validates song_id against the closure's idSet at runtime
 *   - invalid song_id → isError:true → pi's tool_result loop triggers retry
 *   - zero typebox runtime dependency — parameters is a plain JSON Schema object
 */

import type { AgentTool, AgentToolResult } from "./pi-types.d.ts";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type CompanionToolResult = {
  song_id: string;
  target_profile: string;
  rationale: string;
  needed_shift: "接住" | "点燃" | "陪着" | "打断";
  verbal_intent?: "switch" | "repeat" | "adjust_calmer" | "adjust_livelier" | "similar" | null;
};

// ---------------------------------------------------------------------------
// pick_song tool factory
// ---------------------------------------------------------------------------

/**
 * Returns an AgentTool that:
 *  1. Validates the LLM-chosen song_id is in the candidate set.
 *  2. If invalid: returns isError:true so pi's tool loop retries next turn.
 *  3. If valid: calls onResult(r) with the structured result and returns ok.
 *
 * @param idSet      Set of valid candidate song IDs for O(1) lookup.
 * @param candidateIds  Ordered list of IDs (first ≤30 shown in error hints).
 * @param onResult   Called exactly once on the first valid pick.
 */
export function makePickSongTool(
  idSet: Set<string>,
  candidateIds: string[],
  onResult: (r: CompanionToolResult) => void,
): AgentTool<CompanionToolResult> {
  const hintIds = candidateIds.slice(0, 10).join(", ");
  const ellipsis = candidateIds.length > 10 ? ", …" : "";

  return {
    name: "pick_song",
    label: "选一首歌",
    description:
      `从上文列出的候选歌单里选一首,返回其 id + rationale。` +
      ` song_id 必须是这些之一: ${hintIds}${ellipsis}`,
    // Plain JSON Schema — no typebox runtime needed (zero new deps).
    parameters: {
      type: "object",
      required: ["song_id", "target_profile", "rationale", "needed_shift"],
      properties: {
        song_id: { type: "string" },
        target_profile: { type: "string" },
        rationale: { type: "string" },
        needed_shift: {
          type: "string",
          enum: ["接住", "点燃", "陪着", "打断"],
        },
        verbal_intent: {
          type: "string",
          enum: ["switch", "repeat", "adjust_calmer", "adjust_livelier", "similar", "null"],
          description: "用户说的话里是否含有明确意图。无意图时传 \"null\"。",
        },
      },
      additionalProperties: false,
    },
    execute: async (
      _toolCallId: string,
      params: CompanionToolResult,
      _signal?: AbortSignal,
    ): Promise<AgentToolResult> => {
      // Runtime validation: LLM must pick from the actual candidate set.
      if (!idSet.has(params.song_id)) {
        return {
          content: [
            {
              type: "text",
              text:
                `Error: "${params.song_id}" 不在候选列表里。` +
                `请从这些 id 里选一个 (最多列 10 个): ${hintIds}${ellipsis}`,
            },
          ],
          isError: true,
        };
      }

      const VALID_SHIFTS = ["接住", "点燃", "陪着", "打断"] as const;
      type Shift = (typeof VALID_SHIFTS)[number];
      const needed_shift: Shift = (VALID_SHIFTS as readonly string[]).includes(
        params.needed_shift,
      )
        ? (params.needed_shift as Shift)
        : "接住";

      const VALID_VERBAL_INTENTS = [
        "switch",
        "repeat",
        "adjust_calmer",
        "adjust_livelier",
        "similar",
      ] as const;
      type VerbalIntent = (typeof VALID_VERBAL_INTENTS)[number];
      const verbal_intent: VerbalIntent | null =
        (VALID_VERBAL_INTENTS as readonly string[]).includes(params.verbal_intent as string)
          ? (params.verbal_intent as VerbalIntent)
          : null;

      onResult({
        song_id: params.song_id,
        target_profile:
          typeof params.target_profile === "string" ? params.target_profile.trim() : "",
        rationale: typeof params.rationale === "string" ? params.rationale.trim() : "",
        needed_shift,
        verbal_intent,
      });

      return {
        content: [{ type: "text", text: `Selected ${params.song_id}` }],
      };
    },
  };
}
