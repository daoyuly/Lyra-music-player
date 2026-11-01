import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { InputBox } from "./InputBox";
import { bus as perceptionBus } from "../perception/events";

describe("InputBox", () => {
  it("renders with the default placeholder", () => {
    render(<InputBox onSubmit={() => {}} />);
    const input = screen.getByPlaceholderText("和 Lyra 说点什么…") as HTMLTextAreaElement;
    expect(input).toBeInTheDocument();
    expect(input.style.backdropFilter || "").toBe("");
    expect(input.style.background).toBe("transparent");
  });

  it("uses a custom placeholder when provided", () => {
    render(<InputBox onSubmit={() => {}} placeholder="say something" />);
    expect(screen.getByPlaceholderText("say something")).toBeInTheDocument();
  });

  it("submits on Enter and clears the input", () => {
    const spy = vi.fn();
    render(<InputBox onSubmit={spy} />);
    const input = screen.getByPlaceholderText("和 Lyra 说点什么…") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "最近有点累" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(spy).toHaveBeenCalledWith("最近有点累");
    expect(input.value).toBe("");
  });

  it("does not submit an empty line", () => {
    const spy = vi.fn();
    render(<InputBox onSubmit={spy} />);
    fireEvent.keyDown(screen.getByTestId("lyra-input"), { key: "Enter" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("submits an empty line when a show is waiting for the song", () => {
    const spy = vi.fn();
    render(<InputBox onSubmit={spy} allowEmptySubmit placeholder="回车放这首，或说一句改后面" />);
    fireEvent.keyDown(screen.getByPlaceholderText("回车放这首，或说一句改后面"), { key: "Enter" });
    expect(spy).toHaveBeenCalledWith("");
  });

  it("does not submit on Shift+Enter (multi-line)", () => {
    const spy = vi.fn();
    render(<InputBox onSubmit={spy} />);
    const input = screen.getByPlaceholderText("和 Lyra 说点什么…") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "line1" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(spy).not.toHaveBeenCalled();
    expect(input.value).toBe("line1");
  });

  it("disables submission when the disabled prop is set", () => {
    const spy = vi.fn();
    render(<InputBox onSubmit={spy} disabled />);
    const input = screen.getByPlaceholderText("和 Lyra 说点什么…") as HTMLTextAreaElement;
    expect(input.disabled).toBe(true);
    fireEvent.change(input, { target: { value: "x" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("auto-focuses on mount so the first keystroke lands (default true)", async () => {
    render(<InputBox onSubmit={() => {}} />);
    const input = screen.getByPlaceholderText("和 Lyra 说点什么…") as HTMLTextAreaElement;
    // The focus() call is scheduled via setTimeout(_, 0); wait one macrotask.
    await new Promise((r) => setTimeout(r, 5));
    expect(document.activeElement).toBe(input);
  });

  it("does not focus when autoFocus is explicitly false", async () => {
    render(
      <div>
        <button data-testid="other" />
        <InputBox onSubmit={() => {}} autoFocus={false} />
      </div>,
    );
    const input = screen.getByPlaceholderText("和 Lyra 说点什么…") as HTMLTextAreaElement;
    await new Promise((r) => setTimeout(r, 5));
    expect(document.activeElement).not.toBe(input);
  });

  it("does not focus when disabled even if autoFocus is true", async () => {
    render(<InputBox onSubmit={() => {}} disabled />);
    const input = screen.getByPlaceholderText("和 Lyra 说点什么…") as HTMLTextAreaElement;
    await new Promise((r) => setTimeout(r, 5));
    expect(document.activeElement).not.toBe(input);
  });

  it("emits input_dwell_without_submit on type → dwell → clear (no submit)", () => {
    vi.useFakeTimers();
    const before = perceptionBus.recent(60_000).length;
    const { getByTestId } = render(<InputBox onSubmit={() => {}} />);
    const ta = getByTestId("lyra-input") as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "considering it" } });
    vi.advanceTimersByTime(10_001);
    fireEvent.change(ta, { target: { value: "" } });
    const after = perceptionBus.recent(60_000);
    const emitted = after.slice(before).filter((e) => e.kind === "input_dwell_without_submit");
    expect(emitted.length).toBeGreaterThanOrEqual(1);
    vi.useRealTimers();
  });
});
