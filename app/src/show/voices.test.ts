import { describe, expect, it } from "vitest";
import { GUEST_VOICE, LYRA_VOICE, speechLines } from "./voices";

describe("speechLines", () => {
  it("gives Lyra and the guest different voices", () => {
    expect(
      speechLines([
        { speaker: "lyra", text: "雨还在下。" },
        { speaker: "guest", text: "先听这首。" },
      ]),
    ).toEqual([
      { voice: LYRA_VOICE, text: "雨还在下。" },
      { voice: GUEST_VOICE, text: "先听这首。" },
    ]);
  });
});
