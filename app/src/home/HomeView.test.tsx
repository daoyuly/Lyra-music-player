import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { HomeView } from "./HomeView";
import type { Orchestrator, OrchestratorState } from "../turn/Orchestrator";

// ── Stub orchestrator factory ─────────────────────────────────────────────────

function makeStubOrchestrator(initialState: OrchestratorState): Orchestrator {
  let _state = initialState;
  const subs = new Set<(s: OrchestratorState) => void>();
  return {
    getState: () => _state,
    subscribe: (cb: (s: OrchestratorState) => void) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    onUserInput: vi.fn(async () => {}),
    onListenProgress: vi.fn(),
    onSkip: vi.fn(async () => {}),
    onSongComplete: vi.fn(async () => {}),
  } as unknown as Orchestrator;
}

// ── Mock turnRepo so listRecentTurns doesn't hit real DB ──────────────────────

vi.mock("../db/repo/turnRepo", () => ({
  listRecentTurns: vi.fn(() => Promise.resolve([])),
  insertTurn: vi.fn(() => Promise.resolve()),
  updateTurn: vi.fn(() => Promise.resolve()),
}));

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("HomeView — cold boot (no orchestrator)", () => {
  it("renders Lyra hero identity and cold-boot hint", () => {
    render(<HomeView onOpenSettings={() => {}} onOpenDataExplorer={() => {}} onOpenHelp={() => {}} orchestrator={null} />);
    expect(screen.getByText("Lyra")).toBeInTheDocument();
    expect(screen.getByText(/Your emotional music companion/)).toBeInTheDocument();
    expect(screen.getByText(/陪你说话，替你选一首歌/)).toBeInTheDocument();
    expect(screen.getByTestId("cold-boot-hint")).toBeInTheDocument();
    expect(screen.getByText(/Lyra needs an API key to talk/)).toBeInTheDocument();
  });

  it("still renders the ambient surface in cold-boot state", () => {
    render(<HomeView onOpenSettings={() => {}} onOpenDataExplorer={() => {}} onOpenHelp={() => {}} orchestrator={null} />);
    expect(screen.getByTestId("ambient-surface")).toBeInTheDocument();
  });
});

describe("HomeView — idle state", () => {
  it("renders sparse idle state with slogan and input (no cover/note yet)", () => {
    const orc = makeStubOrchestrator({ kind: "idle" });
    render(<HomeView onOpenSettings={() => {}} onOpenDataExplorer={() => {}} onOpenHelp={() => {}} orchestrator={orc} />);
    expect(screen.getByTestId("ambient-surface")).toBeInTheDocument();
    // Sprint 6: sparse idle shows slogan + input only, no cover/band/note
    expect(screen.getByTestId("lyra-idle-slogan")).toBeInTheDocument();
    expect(screen.getByText("Lyra 在听")).toBeInTheDocument();
    expect(screen.getByTestId("lyra-input")).toBeInTheDocument();
    expect(screen.queryByTestId("album-cover-frame")).not.toBeInTheDocument();
    expect(screen.queryByTestId("emotion-light-band")).not.toBeInTheDocument();
    expect(screen.queryByTestId("small-note")).not.toBeInTheDocument();
  });
});

describe("HomeView — thinking state", () => {
  it("shows ellipsis note while thinking", () => {
    const orc = makeStubOrchestrator({ kind: "thinking", user_utterance: "最近有点累" });
    render(<HomeView onOpenSettings={() => {}} onOpenDataExplorer={() => {}} onOpenHelp={() => {}} orchestrator={orc} />);
    expect(screen.getByTestId("small-note")).toHaveTextContent("…");
  });
});

describe("HomeView — playing state", () => {
  const playingState: OrchestratorState = {
    kind: "playing",
    turn: {
      id: "turn-1",
      timestamp: Date.now(),
      current_emotion: {
        pad: { p: 0.3, a: 0.1, d: 0.2 },
        labels: ["calm"],
        confidence: 0.8,
        source: "emotion-agent-inferred",
      },
      user_utterance: { modality: "text", content: "最近有点累" },
      agent_response: {
        song_id: "track-1",
        rationale: "舒缓的旋律，陪你慢下来",
      },
      user_reaction: {
        behavioral: {
          listen_duration_ms: 0,
          completed: false,
          skipped: false,
          repeated: 0,
          volume_delta: 0,
        },
        silence_positive: false,
      },
      emotion_delta: { p: 0, a: 0, d: 0 },
    },
    song: {
      id: "track-1",
      path: "/music/test.flac",
      title: "Nuvole Bianche",
      artist: "Ludovico Einaudi",
      album: undefined,
      duration_ms: undefined,
      added_at: Date.now(),
      origin: "local",
    },
  };

  it("shows real title and artist from song", () => {
    const orc = makeStubOrchestrator(playingState);
    render(<HomeView onOpenSettings={() => {}} onOpenDataExplorer={() => {}} onOpenHelp={() => {}} orchestrator={orc} />);
    const songInfo = screen.getByTestId("song-info");
    expect(songInfo.textContent).toContain("Nuvole Bianche");
    expect(songInfo.textContent).toContain("Ludovico Einaudi");
  });

  it("shows real rationale in small note", () => {
    const orc = makeStubOrchestrator(playingState);
    render(<HomeView onOpenSettings={() => {}} onOpenDataExplorer={() => {}} onOpenHelp={() => {}} orchestrator={orc} />);
    expect(screen.getByTestId("small-note")).toHaveTextContent("舒缓的旋律，陪你慢下来");
  });

  it("can pin an award surface instead of the room", () => {
    const orc = makeStubOrchestrator(playingState);
    render(
      <HomeView
        onOpenSettings={() => {}}
        onOpenDataExplorer={() => {}}
        onOpenHelp={() => {}}
        orchestrator={orc}
        surfaceId="one-line"
      />,
    );
    expect(screen.getByTestId("lyra-surface")).toHaveAttribute("data-surface", "one-line");
    expect(screen.getByText("舒缓的旋律，陪你慢下来")).toBeInTheDocument();
    expect(screen.queryByTestId("small-note")).not.toBeInTheDocument();
  });

  it("renders emotion light band with PAD samples", () => {
    const orc = makeStubOrchestrator(playingState);
    render(<HomeView onOpenSettings={() => {}} onOpenDataExplorer={() => {}} onOpenHelp={() => {}} orchestrator={orc} />);
    expect(screen.getByTestId("emotion-light-band")).toBeInTheDocument();
  });
});

describe("HomeView — proactive-pending state", () => {
  const pendingState: OrchestratorState = {
    kind: "proactive-pending",
    intent: {
      id: "i1",
      createdAt: 1000,
      validUntil: 1000 + 30 * 60_000,
      kind: "morning",
      urgency: 0.5,
      hint: "早上第一次打开",
    },
    song: {
      id: "track-1",
      path: "/music/test.flac",
      title: "Nuvole Bianche",
      artist: "Ludovico Einaudi",
      album: undefined,
      duration_ms: undefined,
      added_at: Date.now(),
      origin: "local",
    },
    rationale: "早安。我想先放这首给你。",
  };

  it("shows rationale and offered song", () => {
    const orc = makeStubOrchestrator(pendingState);
    render(<HomeView onOpenSettings={() => {}} onOpenDataExplorer={() => {}} onOpenHelp={() => {}} orchestrator={orc} />);
    expect(screen.getByTestId("small-note")).toHaveTextContent("早安。我想先放这首给你。");
    const songInfo = screen.getByTestId("song-info");
    expect(songInfo.textContent).toContain("Nuvole Bianche");
    expect(songInfo.textContent).toContain("Ludovico Einaudi");
  });
});

describe("HomeView — error state", () => {
  it("shows error message in small note", () => {
    const orc = makeStubOrchestrator({
      kind: "error",
      message: "library is empty; add music in Settings",
    });
    render(<HomeView onOpenSettings={() => {}} onOpenDataExplorer={() => {}} onOpenHelp={() => {}} orchestrator={orc} />);
    expect(screen.getByTestId("small-note")).toHaveTextContent(
      "library is empty; add music in Settings",
    );
  });
});

describe("HomeView — show-talk", () => {
  it("shows both hosts and the song that will play next", () => {
    const orc = makeStubOrchestrator({
      kind: "show-talk",
      guestName: "林",
      lines: [
        { speaker: "lyra", text: "雨还在下。" },
        { speaker: "guest", text: "先放这首。" },
      ],
      song: {
        id: "a",
        path: "/a.mp3",
        title: "雨",
        artist: "陈奕迅",
        origin: "local",
        added_at: 0,
      },
      beatIndex: 0,
      beatCount: 2,
      pad: { p: 0, a: 0, d: 0 },
    });
    render(<HomeView onOpenSettings={() => {}} onOpenDataExplorer={() => {}} onOpenHelp={() => {}} orchestrator={orc} />);
    expect(screen.getByTestId("small-note").textContent).toContain("Lyra  雨还在下。");
    expect(screen.getByTestId("small-note").textContent).toContain("林  先放这首。");
    expect(screen.getByTestId("song-info").textContent).toContain("雨");
    expect(screen.getByPlaceholderText("说一句就改后面，回车马上放")).toBeInTheDocument();
  });
});
