// A2UI v0.9 wire subset.
// https://a2ui.org/specification/v0.9-a2ui/
// Messages are a flat component list. Children are id references.
// Text and placeholders bind into the live data model with { path }.

export const CATALOG_ID = "https://lyra.local/catalogs/room/v1";

export type SurfaceId =
  | "room"
  | "one-line"
  | "aside"
  | "chart"
  | "speak"
  | "because"
  | "glass"
  | "page";

export const SURFACE_IDS: readonly SurfaceId[] = [
  "room",
  "one-line",
  "aside",
  "chart",
  "speak",
  "because",
  "glass",
  "page",
];

export const SURFACE_LABEL: Record<SurfaceId, string> = {
  room: "房间",
  "one-line": "一句",
  aside: "让开",
  chart: "潮汐",
  speak: "开口",
  because: "为什么",
  glass: "光",
  page: "句子",
};

export function isSurfaceId(value: string): value is SurfaceId {
  return (SURFACE_IDS as readonly string[]).includes(value);
}

/** Literal string, or a binding into the surface data model. */
export type BoundString = string | { path: string };

export type LyraComponent = {
  id: string;
  component: "Column" | "Spacer" | "Text" | "Song" | "Note" | "Band" | "Input" | "Glass";
  children?: string[];
  text?: BoundString;
  placeholder?: BoundString;
  role?: "slogan" | "display" | "caption" | "whisper" | "song" | "note";
  fade?: boolean;
  ellipsizeAt?: number;
  align?: "start" | "center" | "end";
  justify?: "start" | "center" | "end" | "space-between";
  gap?: number;
  width?: number;
  fill?: boolean;
  pad?: boolean;
  variant?: "line" | "hero";
  showEmpty?: boolean;
  bandWidth?: number;
  bandHeight?: number;
};

export type A2uiMessage =
  | {
      version: "v0.9";
      createSurface: { surfaceId: SurfaceId; catalogId: string };
    }
  | {
      version: "v0.9";
      updateComponents: { surfaceId: SurfaceId; components: LyraComponent[] };
    };

export type LyraSurfaceModel = {
  sentence: string;
  title: string;
  artist: string;
  placeholder: string;
  whyLabel: string;
  chartLabel: string;
  noteColor?: string;
};

export function resolveBound(value: BoundString | undefined, model: LyraSurfaceModel): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  const key = value.path.replace(/^\//, "") as keyof LyraSurfaceModel;
  const resolved = model[key];
  return typeof resolved === "string" ? resolved : "";
}

let sessionSurface: SurfaceId | null = null;

function surfaceFromLocation(): SurfaceId | null {
  if (typeof window === "undefined") return null;
  const raw = new URLSearchParams(window.location.search).get("surface");
  if (raw && isSurfaceId(raw)) return raw;
  return null;
}

/** One surface per process. Tests stay on the original room. */
export function currentSurface(): SurfaceId {
  if (import.meta.env.MODE === "test" || import.meta.env.VITEST) return "room";
  if (sessionSurface) return sessionSurface;
  const fromUrl = surfaceFromLocation();
  if (fromUrl) {
    sessionSurface = fromUrl;
    return sessionSurface;
  }
  sessionSurface = SURFACE_IDS[Math.floor(Math.random() * SURFACE_IDS.length)]!;
  return sessionSurface;
}
