import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { HelpOverlay } from "./HelpOverlay";

describe("HelpOverlay", () => {
  it("renders nothing when closed", () => {
    render(<HelpOverlay open={false} onClose={() => {}} />);
    expect(screen.queryByTestId("help-overlay")).not.toBeInTheDocument();
  });

  it("renders the four core sections when open", () => {
    render(<HelpOverlay open={true} onClose={() => {}} />);
    expect(screen.getByTestId("help-overlay")).toBeInTheDocument();
    expect(screen.getByText("命令")).toBeInTheDocument();
    expect(screen.getByText("我是谁")).toBeInTheDocument();
    expect(screen.getByText("怎么和我说话")).toBeInTheDocument();
    expect(screen.getByText("数据在哪里")).toBeInTheDocument();
  });

  it("lists all five slash commands", () => {
    render(<HelpOverlay open={true} onClose={() => {}} />);
    const overlay = screen.getByTestId("help-overlay");
    expect(overlay.textContent).toContain("/help");
    expect(overlay.textContent).toContain("/settings");
    expect(overlay.textContent).toContain("/stats");
    expect(overlay.textContent).toContain("/explorer");
    expect(overlay.textContent).toContain("/reload-musics");
    expect(overlay.textContent).toContain("/show");
  });

  it("uses first-person voice (「我」, not 「她」)", () => {
    render(<HelpOverlay open={true} onClose={() => {}} />);
    const text = screen.getByTestId("help-overlay").textContent ?? "";
    expect(text).toContain("我是 Lyra");
    expect(text).not.toMatch(/她/);
  });

  it("closes on button click", () => {
    const onClose = vi.fn();
    render(<HelpOverlay open={true} onClose={onClose} />);
    fireEvent.click(screen.getByTestId("help-close"));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes on backdrop click", () => {
    const onClose = vi.fn();
    render(<HelpOverlay open={true} onClose={onClose} />);
    fireEvent.click(screen.getByTestId("help-backdrop"));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes on Escape key", () => {
    const onClose = vi.fn();
    render(<HelpOverlay open={true} onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
