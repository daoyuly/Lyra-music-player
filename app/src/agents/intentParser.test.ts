import { describe, it, expect } from "vitest";
import { parseIntent } from "./intentParser";

describe("parseIntent", () => {
  it("extracts sticky Cantonese intent", () => {
    const r = parseIntent("一直播放粤语歌曲");
    expect(r.clear).toBe(false);
    expect(r.hit).toBe(true);
    expect(r.persistence).toBe("sticky");
    expect(r.constraints.languages).toEqual(["yue"]);
  });

  it("extracts Mandarin + genre", () => {
    const r = parseIntent("来点国语摇滚");
    expect(r.hit).toBe(true);
    expect(r.constraints.languages).toEqual(["cmn"]);
    expect(r.constraints.genres).toEqual(["摇滚"]);
    expect(r.persistence).toBe("once");
  });

  it("detects clear/cancel phrases", () => {
    const r = parseIntent("别放粤语了，随便来点");
    expect(r.clear).toBe(true);
    expect(r.hit).toBe(true);
  });

  it("returns hit:false for pure emotion talk", () => {
    const r = parseIntent("最近有点累");
    expect(r.hit).toBe(false);
    expect(r.clear).toBe(false);
  });

  it("maps cantonese English alias", () => {
    const r = parseIntent("keep playing cantonese songs");
    expect(r.constraints.languages).toEqual(["yue"]);
  });

  it("extracts scene tags", () => {
    const r = parseIntent("来点雨天适合听的");
    expect(r.constraints.scenes).toEqual(["雨天"]);
  });
});
