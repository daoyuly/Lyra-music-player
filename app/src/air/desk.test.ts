import { describe, expect, it, vi } from "vitest";
import { AirDesk } from "./desk";
import { chimeBulletin, taskBulletin } from "./bulletin";

function at(hour: number, minute = 0): Date {
  return new Date(2026, 6, 7, hour, minute, 0, 0);
}

describe("AirDesk", () => {
  it("speaks immediately during the day", () => {
    const air = vi.fn(async () => {});
    const desk = new AirDesk(air, () => at(9, 0));
    const bulletin = taskBulletin("这周的信写好了。");
    desk.post(bulletin!);
    expect(air).toHaveBeenCalledWith(bulletin);
  });

  it("holds a night result and speaks it after six", () => {
    const air = vi.fn(async () => {});
    let now = at(3, 14);
    const desk = new AirDesk(air, () => now);
    const bulletin = taskBulletin("昨夜我看见她坐在窗边。");
    desk.post(bulletin!);
    expect(air).not.toHaveBeenCalled();

    desk.tick(at(5, 59));
    expect(air).not.toHaveBeenCalled();

    now = at(6, 0);
    desk.tick(now);
    expect(air).toHaveBeenCalledWith(bulletin);
  });

  it("drops a chime during quiet hours and keeps a task result", () => {
    const air = vi.fn(async () => {});
    const desk = new AirDesk(air, () => at(23, 0));
    const chime = chimeBulletin(at(23, 0));
    const task = taskBulletin("昨夜我看见她坐在窗边。");
    desk.post(chime);
    desk.post(task!);
    desk.tick(at(6, 1));
    expect(air).toHaveBeenCalledTimes(1);
    expect(air).toHaveBeenCalledWith(task);
  });
});
