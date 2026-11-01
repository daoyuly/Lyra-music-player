import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { A2uiSurface } from "./A2uiSurface";
import type { LyraSurfaceModel } from "./protocol";

const model: LyraSurfaceModel = {
  sentence: "舒缓的旋律，陪你慢下来",
  title: "Nuvole Bianche",
  artist: "Ludovico Einaudi",
  placeholder: "和 Lyra 说点什么…",
  whyLabel: "为什么是这首",
  chartLabel: "这是这阵子的心情",
};

describe("A2uiSurface", () => {
  it("renders the because layout with the reason ahead of the song", () => {
    render(
      <A2uiSurface
        surfaceId="because"
        model={model}
        samples={[{ p: 0.2, a: 0.1, d: 0 }]}
        songVisible
        allowEmptySubmit={false}
        onSubmit={vi.fn()}
      />,
    );
    const note = screen.getByTestId("small-note");
    const song = screen.getByTestId("song-info");
    expect(note).toHaveTextContent("舒缓的旋律，陪你慢下来");
    expect(screen.getByText("为什么是这首")).toBeInTheDocument();
    expect(song.textContent).toContain("Nuvole Bianche");
    expect(note.compareDocumentPosition(song) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByTestId("lyra-surface")).toHaveAttribute("data-surface", "because");
  });

  it("keeps the chart label with the ink band", () => {
    render(
      <A2uiSurface
        surfaceId="chart"
        model={model}
        samples={[{ p: 0.2, a: 0.4, d: 0 }]}
        songVisible
        allowEmptySubmit={false}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByText("这是这阵子的心情")).toBeInTheDocument();
    expect(screen.getByTestId("emotion-light-band")).toBeInTheDocument();
  });

  it("hides an empty chart instead of drawing a blank band", () => {
    render(
      <A2uiSurface
        surfaceId="chart"
        model={{ ...model, chartLabel: "", title: "", artist: "" }}
        samples={[]}
        songVisible
        allowEmptySubmit={false}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("emotion-light-band")).not.toBeInTheDocument();
    expect(screen.queryByText("这是这阵子的心情")).not.toBeInTheDocument();
  });
});
