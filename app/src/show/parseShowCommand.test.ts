import { describe, expect, it } from "vitest";
import { parseShowCommand } from "./parseShowCommand";

describe("parseShowCommand", () => {
  it("starts a show from a topic and uses the default guest", () => {
    expect(parseShowCommand("/show 今晚的雨")).toEqual({
      kind: "start",
      topic: "今晚的雨",
      guestName: "林",
    });
  });

  it("lets the user name the guest before the topic", () => {
    expect(parseShowCommand("/show 阿禾 / 下班路上")).toEqual({
      kind: "start",
      topic: "下班路上",
      guestName: "阿禾",
    });
  });

  it("ends the show", () => {
    expect(parseShowCommand("/show off")).toEqual({ kind: "off" });
  });

  it("treats a bare /show as a start with an empty topic", () => {
    expect(parseShowCommand("/show")).toEqual({
      kind: "start",
      topic: "",
      guestName: "林",
    });
  });

  it("ignores ordinary chat", () => {
    expect(parseShowCommand("今晚的雨")).toBeNull();
    expect(parseShowCommand("/settings")).toBeNull();
  });
});
