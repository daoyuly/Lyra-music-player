import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Settings } from "./Settings";

vi.mock("./secrets", () => ({
  SECRET_KEYS: {
    anthropicApiKey: "provider.anthropic.apiKey",
    deepseekApiKey: "provider.deepseek.apiKey",
    zhipuApiKey: "provider.zhipu.apiKey",
    libraryRootPath: "library.rootPath",
    dreamDailyTime: "dream.dailyTime",
    dreamIdleMinutes: "dream.idleMinutes",
    perceptionEnabled: "perception.enabled",
    perceptionMode: "perception.mode",
    embeddingProvider: "embedding.provider",
    zhipuEmbeddingApiKey: "embedding.zhipu.apiKey",
    openaiApiKey: "embedding.openai.apiKey",
    weeklyDirOverride: "weekly.dirOverride",
    weeklyAutoEnabled: "weekly.autoEnabled",
    weatherEnabled: "perception.weatherEnabled",
    weatherLat: "perception.weatherLat",
    weatherLon: "perception.weatherLon",
  },
  setSecret: vi.fn(),
  getSecret: vi.fn(),
  deleteSecret: vi.fn(),
}));

vi.mock("../library/libraryScan", () => ({
  importLibrary: vi.fn(() => Promise.resolve(0)),
}));

vi.mock("../library/lyricsRefill", () => ({
  lyricsRefill: vi.fn(() =>
    Promise.resolve({ started: 0, succeeded: 0, failed: 0 }),
  ),
}));

vi.mock("../reflect/trigger", () => ({
  reflectNow: vi.fn(),
}));

import { setSecret, getSecret } from "./secrets";
import { importLibrary } from "../library/libraryScan";
import { lyricsRefill } from "../library/lyricsRefill";
import { reflectNow } from "../reflect/trigger";

beforeEach(() => {
  (setSecret as any).mockReset();
  (getSecret as any).mockReset();
  (importLibrary as any).mockReset();
  (importLibrary as any).mockResolvedValue(0);
  (lyricsRefill as any).mockReset();
  (lyricsRefill as any).mockResolvedValue({ started: 0, succeeded: 0, failed: 0 });
  (reflectNow as any).mockReset();
});

describe("Settings", () => {
  it("does not render when closed", () => {
    render(<Settings open={false} onClose={() => {}} />);
    expect(screen.queryByLabelText(/anthropic/i)).toBeNull();
  });

  it("loads existing secrets on open", async () => {
    (getSecret as any).mockImplementation((k: string) =>
      k === "provider.anthropic.apiKey" ? Promise.resolve("sk-a") : Promise.resolve(null)
    );
    render(<Settings open={true} onClose={() => {}} />);
    await waitFor(() =>
      expect((screen.getByLabelText(/anthropic/i) as HTMLInputElement).value).toBe("sk-a")
    );
  });

  it("loads stored library path on open", async () => {
    (getSecret as any).mockImplementation((k: string) =>
      k === "library.rootPath" ? Promise.resolve("/Users/x/Music") : Promise.resolve(null)
    );
    render(<Settings open={true} onClose={() => {}} />);
    await waitFor(() =>
      expect((screen.getByLabelText(/music library folder/i) as HTMLInputElement).value).toBe(
        "/Users/x/Music"
      )
    );
  });

  it("saves all three secrets on Save click and calls onClose", async () => {
    (getSecret as any).mockResolvedValue(null);
    (setSecret as any).mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(<Settings open={true} onClose={onClose} />);

    const aInput = await screen.findByLabelText(/anthropic/i);
    const dInput = screen.getByLabelText(/deepseek/i);
    const zInput = screen.getByLabelText(/zhipu/i);
    fireEvent.change(aInput, { target: { value: "sk-new-a" } });
    fireEvent.change(dInput, { target: { value: "sk-new-d" } });
    fireEvent.change(zInput, { target: { value: "sk-new-z" } });

    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      expect(setSecret).toHaveBeenCalledWith("provider.anthropic.apiKey", "sk-new-a");
      expect(setSecret).toHaveBeenCalledWith("provider.deepseek.apiKey", "sk-new-d");
      expect(setSecret).toHaveBeenCalledWith("provider.zhipu.apiKey", "sk-new-z");
      expect(onClose).toHaveBeenCalled();
    });
  });

  it("saves library path and calls importLibrary on Save when path is set", async () => {
    (getSecret as any).mockResolvedValue(null);
    (setSecret as any).mockResolvedValue(undefined);
    (importLibrary as any).mockResolvedValue(3);
    const onClose = vi.fn();
    render(<Settings open={true} onClose={onClose} />);

    const libInput = await screen.findByLabelText(/music library folder/i);
    fireEvent.change(libInput, { target: { value: "/Users/x/Music" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      expect(setSecret).toHaveBeenCalledWith("library.rootPath", "/Users/x/Music");
      expect(importLibrary).toHaveBeenCalledWith("/Users/x/Music");
      expect(onClose).toHaveBeenCalled();
    });
  });

  it("Cancel button closes without saving", async () => {
    (getSecret as any).mockResolvedValue(null);
    const onClose = vi.fn();
    render(<Settings open={true} onClose={onClose} />);
    await screen.findByLabelText(/anthropic/i);
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onClose).toHaveBeenCalled();
    expect(setSecret).not.toHaveBeenCalled();
  });

  it("Reflect now button calls reflectNow and shows status message", async () => {
    (getSecret as any).mockResolvedValue(null);
    (reflectNow as any).mockResolvedValue({ appliedFacts: 3, dreamAdded: true });
    render(<Settings open={true} onClose={() => {}} />);

    // Wait for the component to load
    await screen.findByLabelText(/anthropic/i);

    fireEvent.click(screen.getByRole("button", { name: /reflect now/i }));

    await waitFor(() => {
      expect(reflectNow).toHaveBeenCalledOnce();
      expect(screen.getByText(/reflected — 3 fact updates \+ one dream/i)).toBeInTheDocument();
    });
  });

  it("Reflect now button shows error message when reflectNow throws", async () => {
    (getSecret as any).mockResolvedValue(null);
    (reflectNow as any).mockRejectedValue(new Error("network error"));
    render(<Settings open={true} onClose={() => {}} />);

    await screen.findByLabelText(/anthropic/i);

    fireEvent.click(screen.getByRole("button", { name: /reflect now/i }));

    await waitFor(() => {
      expect(screen.getByText(/reflect failed: network error/i)).toBeInTheDocument();
    });
  });

  it("loads stored dream daily time and idle threshold on open", async () => {
    (getSecret as any).mockImplementation((k: string) => {
      if (k === "dream.dailyTime") return Promise.resolve("04:00");
      if (k === "dream.idleMinutes") return Promise.resolve("45");
      return Promise.resolve(null);
    });
    render(<Settings open={true} onClose={() => {}} />);
    await waitFor(() => {
      expect(
        (screen.getByLabelText(/daily dream time/i) as HTMLInputElement).value
      ).toBe("04:00");
      expect(
        (screen.getByLabelText(/idle threshold/i) as HTMLInputElement).value
      ).toBe("45");
    });
  });

  it("saves dream settings on Save and calls onSchedulerUpdate", async () => {
    (getSecret as any).mockResolvedValue(null);
    (setSecret as any).mockResolvedValue(undefined);
    const onSchedulerUpdate = vi.fn();
    const onClose = vi.fn();
    render(
      <Settings open={true} onClose={onClose} onSchedulerUpdate={onSchedulerUpdate} />
    );

    const dtInput = await screen.findByLabelText(/daily dream time/i);
    const idleInput = screen.getByLabelText(/idle threshold/i);
    fireEvent.change(dtInput, { target: { value: "02:30" } });
    fireEvent.change(idleInput, { target: { value: "60" } });

    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      expect(setSecret).toHaveBeenCalledWith("dream.dailyTime", "02:30");
      expect(setSecret).toHaveBeenCalledWith("dream.idleMinutes", "60");
      expect(onSchedulerUpdate).toHaveBeenCalledWith("02:30", 60, "09:00");
      expect(onClose).toHaveBeenCalled();
    });
  });

  it("Refill button is disabled after picking a provider until Save persists it", async () => {
    (getSecret as any).mockResolvedValue(null);
    render(<Settings open={true} onClose={() => {}} />);

    await screen.findByLabelText(/anthropic/i);
    const providerSelect = screen.getByLabelText(
      /lyrics embedding provider/i,
    ) as HTMLSelectElement;
    fireEvent.change(providerSelect, { target: { value: "zhipu" } });

    const btn = await screen.findByRole("button", {
      name: /refill missing lyrics embeddings/i,
    });
    expect(btn).toBeDisabled(); // dirty — Save first
  });

  it("Refill button fires lyricsRefill once provider is loaded from storage", async () => {
    (getSecret as any).mockImplementation((k: string) =>
      k === "embedding.provider" ? Promise.resolve("zhipu") : Promise.resolve(null),
    );
    (lyricsRefill as any).mockResolvedValue({ started: 5, succeeded: 5, failed: 0 });
    render(<Settings open={true} onClose={() => {}} />);

    await screen.findByLabelText(/anthropic/i);
    const btn = await screen.findByRole("button", {
      name: /refill missing lyrics embeddings/i,
    });
    // Provider was hydrated from storage → dirty=false → enabled
    await waitFor(() => expect(btn).not.toBeDisabled());
    fireEvent.click(btn);

    await waitFor(() => {
      expect(lyricsRefill).toHaveBeenCalledTimes(1);
      expect(
        screen.getByText(/refill: 5 succeeded, 0 failed \(of 5\)\./i),
      ).toBeInTheDocument();
    });
  });
});
