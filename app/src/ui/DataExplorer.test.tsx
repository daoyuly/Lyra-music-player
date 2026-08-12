import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { DataExplorer } from "./DataExplorer";

vi.mock("../db/repo/turnRepo", () => ({
  listRecentTurns: vi.fn(() => Promise.resolve([])),
}));
vi.mock("../db/repo/lyricsEmbeddingsRepo", () => ({
  countCoverage: vi.fn(() =>
    Promise.resolve({
      total: 100,
      withEmbedding: 66,
      modelId: "zhipu:embedding-3",
    }),
  ),
}));
vi.mock("../db/repo/soulRepo", () => ({
  loadSoulState: vi.fn(() => Promise.resolve(null)),
}));
vi.mock("../db/repo/sharedMemoryRepo", () => ({
  listRecent: vi.fn(() => Promise.resolve([])),
}));
vi.mock("../db/repo/libraryRepo", () => ({
  listAll: vi.fn(() => Promise.resolve([])),
}));
vi.mock("../db/repo/libraryFeaturesRepo", () => ({
  getBatch: vi.fn(() => Promise.resolve(new Map())),
}));
vi.mock("../db/repo/perceptionAuditRepo", () => ({
  listRecent: vi.fn(() => Promise.resolve([])),
}));
vi.mock("../db/repo/engineerAuditRepo", () => ({
  listRecent: vi.fn(() => Promise.resolve([])),
}));
vi.mock("../db/repo/roadmapRepo", () => ({
  listAll: vi.fn(() => Promise.resolve([])),
}));
vi.mock("../db/repo/featureRequestRepo", () => ({
  listSince: vi.fn(() => Promise.resolve([])),
}));
vi.mock("../memory/fileIO", () => ({
  readMemoryFile: vi.fn(() => Promise.resolve("")),
}));
vi.mock("../db/repo/llmUsageRepo", () => ({
  listRecent: vi.fn(() => Promise.resolve([])),
  aggregateByModel: vi.fn(() => Promise.resolve([])),
}));
vi.mock("../db/repo/reasoningTracesRepo", () => ({
  listRecent: vi.fn(() =>
    Promise.resolve([
      {
        id: "trc-1",
        turn_id: null,
        agent_kind: "companion",
        prompt_text: "brief",
        raw_response: "raw",
        parsed_json: '{"rationale":"see you soon"}',
        duration_ms: 420,
        ts: 1_710_000_000_000,
      },
    ]),
  ),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("DataExplorer", () => {
  it("does not render when open=false", () => {
    render(<DataExplorer open={false} onClose={() => {}} />);
    expect(screen.queryByTestId("data-explorer")).toBeNull();
  });

  it("renders modal + tab strip when open", () => {
    render(<DataExplorer open={true} onClose={() => {}} />);
    expect(screen.getByTestId("data-explorer")).toBeInTheDocument();
    expect(screen.getByTestId("tab-turns")).toBeInTheDocument();
    expect(screen.getByTestId("tab-soul")).toBeInTheDocument();
    expect(screen.getByTestId("tab-salient")).toBeInTheDocument();
    expect(screen.getByTestId("tab-library")).toBeInTheDocument();
    expect(screen.getByTestId("tab-lyrics_emb")).toBeInTheDocument();
    expect(screen.getByTestId("tab-perception")).toBeInTheDocument();
    expect(screen.getByTestId("tab-roadmap")).toBeInTheDocument();
    expect(screen.getByTestId("tab-features_req")).toBeInTheDocument();
    expect(screen.getByTestId("tab-engineer")).toBeInTheDocument();
    expect(screen.getByTestId("tab-reasoning")).toBeInTheDocument();
    expect(screen.getByTestId("tab-memory_md")).toBeInTheDocument();
  });

  it("starts on the playback tab and shows empty-state when there are no plays", async () => {
    render(<DataExplorer open={true} onClose={() => {}} />);
    await waitFor(() =>
      expect(screen.getByText(/还没有播放记录/)).toBeInTheDocument(),
    );
  });

  it("lyrics_emb tab shows coverage stats", async () => {
    render(<DataExplorer open={true} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId("tab-lyrics_emb"));
    await waitFor(() =>
      expect(screen.getByTestId("panel-lyrics_emb")).toBeInTheDocument(),
    );
    expect(screen.getByText(/66%/)).toBeInTheDocument();
    expect(screen.getByText(/zhipu:embedding-3/)).toBeInTheDocument();
  });

  it("reasoning tab lists traces and shows agent + latency", async () => {
    render(<DataExplorer open={true} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId("tab-reasoning"));
    await waitFor(() =>
      expect(screen.getByTestId("reasoning-row")).toBeInTheDocument(),
    );
    // The summariseTrace extracted the rationale from parsed_json.
    expect(screen.getByText(/see you soon/i)).toBeInTheDocument();
    expect(screen.getByText(/companion/)).toBeInTheDocument();
    expect(screen.getByText(/420ms/)).toBeInTheDocument();
  });
});
