import type { CSSProperties, ReactNode } from "react";
import type { PAD } from "../../types";
import { EmotionLightBand } from "../EmotionLightBand";
import { InputBox } from "../InputBox";
import { SmallNote } from "../SmallNote";
import { SongInfo } from "../SongInfo";
import {
  SURFACE_LABEL,
  resolveBound,
  type LyraComponent,
  type LyraSurfaceModel,
  type SurfaceId,
} from "./protocol";
import { componentsOf } from "./surfaces";
import { SESSION_BG } from "../bgManifest";

export type A2uiSurfaceProps = {
  surfaceId: SurfaceId;
  model: LyraSurfaceModel;
  samples: PAD[];
  songVisible: boolean;
  allowEmptySubmit: boolean;
  onSubmit: (text: string) => void;
};

type RenderEnv = Omit<A2uiSurfaceProps, "surfaceId"> & {
  byId: Map<string, LyraComponent>;
};

export function A2uiSurface({ surfaceId, ...env }: A2uiSurfaceProps) {
  const components = componentsOf(surfaceId);
  const byId = new Map(components.map((component) => [component.id, component]));
  const root = byId.get("root");
  return (
    <div
      data-testid="lyra-surface"
      data-surface={surfaceId}
      style={{
        flex: 1,
        display: "flex",
        minHeight: "100vh",
        position: "relative",
        zIndex: 2,
        ...(SESSION_BG?.contentPadding
          ? { ["--lyra-viewport-padding" as string]: SESSION_BG.contentPadding }
          : {}),
      }}
    >
      {root ? renderNode(root, { ...env, byId }) : null}
      <div
        data-testid="lyra-surface-label"
        style={{
          position: "absolute",
          left: 22,
          bottom: 16,
          fontSize: 12,
          letterSpacing: "0.18em",
          opacity: 0.38,
          pointerEvents: "none",
          color: "var(--lyra-color-song-info)",
        }}
      >
        {SURFACE_LABEL[surfaceId]}
      </div>
    </div>
  );
}

function renderNode(node: LyraComponent, env: RenderEnv): ReactNode {
  const child = (id: string) => {
    const next = env.byId.get(id);
    return next ? renderNode(next, env) : null;
  };

  switch (node.component) {
    case "Column":
      return (
        <div key={node.id} style={columnStyle(node)}>
          {node.children?.map((id) => child(id))}
        </div>
      );
    case "Spacer":
      return <div key={node.id} style={{ flex: 1, minHeight: 12 }} />;
    case "Glass":
      return (
        <div key={node.id} style={glassStyle}>
          {node.children?.map((id) => child(id))}
        </div>
      );
    case "Text": {
      const text = resolveBound(node.text, env.model);
      if (!text) return null;
      return (
        <div key={node.id} style={textStyle(node.role)}>
          {text}
        </div>
      );
    }
    case "Song": {
      if (!env.model.title) return null;
      const faded = node.fade === true && !env.songVisible;
      return (
        <div
          key={node.id}
          data-testid="song-info-fade"
          style={{
            opacity: faded ? 0 : 1,
            transition: node.fade ? "opacity 1.4s ease-out" : undefined,
            pointerEvents: faded ? "none" : "auto",
          }}
        >
          <SongInfo
            title={env.model.title}
            artist={env.model.artist}
            fontSize={node.role === "whisper" ? "13px" : undefined}
            maxWidth={node.role === "whisper" ? "280px" : undefined}
          />
        </div>
      );
    }
    case "Note": {
      if (!env.model.sentence) return null;
      const display = node.role === "display";
      return (
        <SmallNote
          key={node.id}
          text={env.model.sentence}
          color={env.model.noteColor}
          ellipsizeAt={node.ellipsizeAt ?? (env.model.sentence.includes("\n") ? 480 : 40)}
          size={display ? "1.65rem" : undefined}
          maxWidth={display ? "36rem" : undefined}
        />
      );
    }
    case "Band": {
      if (!node.showEmpty && env.samples.length === 0) return null;
      return (
        <div
          key={node.id}
          style={{
            ["--lyra-band-width" as string]: `${node.bandWidth ?? 400}px`,
            ["--lyra-band-height" as string]: `${node.bandHeight ?? 32}px`,
          }}
        >
          <EmotionLightBand samples={env.samples} />
        </div>
      );
    }
    case "Input":
      return (
        <div key={node.id} style={node.variant === "hero" ? heroInputStyle : lineInputStyle}>
          <InputBox
            onSubmit={env.onSubmit}
            allowEmptySubmit={env.allowEmptySubmit}
            placeholder={resolveBound(node.placeholder, env.model) || undefined}
          />
        </div>
      );
    default:
      return null;
  }
}

function columnStyle(node: LyraComponent): CSSProperties {
  const justify =
    node.justify === "center"
      ? "center"
      : node.justify === "end"
        ? "flex-end"
        : node.justify === "space-between"
          ? "space-between"
          : "flex-start";
  const align =
    node.align === "start" ? "flex-start" : node.align === "end" ? "flex-end" : "center";
  return {
    display: "flex",
    flexDirection: "column",
    justifyContent: justify,
    alignItems: align,
    gap: node.gap ?? 0,
    flex: node.fill ? 1 : undefined,
    width: node.fill ? "100%" : undefined,
    maxWidth: node.width,
    minHeight: node.fill ? "100%" : undefined,
    padding: node.pad ? "var(--lyra-viewport-padding)" : undefined,
    boxSizing: "border-box",
  };
}

const glassStyle: CSSProperties = {
  width: "min(520px, 100%)",
  padding: "40px 32px",
  borderRadius: 28,
  background: "rgba(255,255,255,0.46)",
  border: "1px solid rgba(255,255,255,0.55)",
  backdropFilter: "blur(22px)",
  WebkitBackdropFilter: "blur(22px)",
};

function textStyle(role: LyraComponent["role"]): CSSProperties {
  if (role === "display") {
    return {
      fontFamily: "var(--lyra-note-family)",
      fontStyle: "italic",
      fontSize: "2rem",
      lineHeight: 1.45,
      textAlign: "center",
      maxWidth: "36rem",
      color: "var(--lyra-color-song-info)",
      textShadow: "0 0 18px rgba(255,255,255,0.55)",
    };
  }
  if (role === "caption") {
    return {
      fontSize: 13,
      letterSpacing: "0.22em",
      textTransform: "none",
      opacity: 0.55,
      color: "var(--lyra-color-song-info)",
    };
  }
  return {
    fontSize: 13,
    opacity: 0.5,
    textAlign: "center",
    color: "var(--lyra-color-song-info)",
  };
}

const lineInputStyle: CSSProperties = {
  display: "flex",
  justifyContent: "center",
  width: "100%",
  ["--lyra-input-max-width" as string]: "100%",
};

const heroInputStyle: CSSProperties = {
  display: "flex",
  justifyContent: "center",
  width: "min(720px, 100%)",
  padding: 8,
  borderRadius: 32,
  background: "rgba(255,255,255,0.28)",
  border: "1px solid rgba(255,255,255,0.45)",
  ["--lyra-input-height" as string]: "64px",
  ["--lyra-song-font-size" as string]: "18px",
  ["--lyra-input-max-width" as string]: "100%",
};
