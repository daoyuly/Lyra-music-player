import {
  CATALOG_ID,
  type A2uiMessage,
  type LyraComponent,
  type SurfaceId,
} from "./protocol";

function documentFor(id: SurfaceId, components: LyraComponent[]): A2uiMessage[] {
  return [
    { version: "v0.9", createSurface: { surfaceId: id, catalogId: CATALOG_ID } },
    { version: "v0.9", updateComponents: { surfaceId: id, components } },
  ];
}

// Each document is one award method, composed only from the Lyra catalog.
// The player state arrives later through path bindings, not as baked copy.
export const SURFACES: Record<SurfaceId, A2uiMessage[]> = {
  // The room as it already is: band, song, note, input, with the song fading.
  room: documentFor("room", [
    {
      id: "root",
      component: "Column",
      fill: true,
      pad: true,
      align: "center",
      children: ["top", "stack", "bottom", "input"],
    },
    { id: "top", component: "Spacer" },
    {
      id: "stack",
      component: "Column",
      align: "center",
      gap: 18,
      children: ["band", "song", "note"],
    },
    { id: "band", component: "Band", showEmpty: true },
    { id: "song", component: "Song", fade: true, role: "song" },
    { id: "note", component: "Note", role: "note" },
    { id: "bottom", component: "Spacer" },
    { id: "input", component: "Input", variant: "line", placeholder: { path: "/placeholder" } },
  ]),

  // grug / CapWords: one sentence is the whole interface.
  "one-line": documentFor("one-line", [
    {
      id: "root",
      component: "Column",
      fill: true,
      pad: true,
      justify: "center",
      align: "center",
      gap: 36,
      children: ["lead", "song", "input"],
    },
    { id: "lead", component: "Text", role: "display", text: { path: "/sentence" } },
    { id: "song", component: "Song", role: "whisper" },
    { id: "input", component: "Input", variant: "line", placeholder: { path: "/placeholder" } },
  ]),

  // Primary: the interface steps aside. The sentence sits in the open, the input waits at the edge.
  aside: documentFor("aside", [
    {
      id: "root",
      component: "Column",
      fill: true,
      pad: true,
      align: "center",
      children: ["top", "note", "song", "bottom", "input"],
    },
    { id: "top", component: "Spacer" },
    { id: "note", component: "Note", role: "display", ellipsizeAt: 160 },
    { id: "song", component: "Song", role: "whisper" },
    { id: "bottom", component: "Spacer" },
    { id: "input", component: "Input", variant: "line", placeholder: { path: "/placeholder" } },
  ]),

  // Tide Guide: the trace is a chart you can read, and the color already follows the room.
  chart: documentFor("chart", [
    {
      id: "root",
      component: "Column",
      fill: true,
      pad: true,
      justify: "center",
      align: "center",
      gap: 22,
      children: ["caption", "band", "song", "note", "input"],
    },
    { id: "caption", component: "Text", role: "caption", text: { path: "/chartLabel" } },
    { id: "band", component: "Band", bandWidth: 640, bandHeight: 72 },
    { id: "song", component: "Song", role: "song" },
    { id: "note", component: "Note", role: "note", ellipsizeAt: 80 },
    { id: "input", component: "Input", variant: "line", placeholder: { path: "/placeholder" } },
  ]),

  // Material expressive: the thing you can do — speak — is the largest object.
  speak: documentFor("speak", [
    {
      id: "root",
      component: "Column",
      fill: true,
      pad: true,
      justify: "center",
      align: "center",
      gap: 22,
      children: ["song", "note", "input"],
    },
    { id: "song", component: "Song", role: "whisper" },
    { id: "note", component: "Note", role: "note", ellipsizeAt: 72 },
    { id: "input", component: "Input", variant: "hero", placeholder: { path: "/placeholder" } },
  ]),

  // The shuttle: say why the room changed before you name the song.
  because: documentFor("because", [
    {
      id: "root",
      component: "Column",
      fill: true,
      pad: true,
      justify: "center",
      align: "center",
      gap: 18,
      children: ["caption", "note", "song", "input"],
    },
    { id: "caption", component: "Text", role: "caption", text: { path: "/whyLabel" } },
    { id: "note", component: "Note", role: "display", ellipsizeAt: 180 },
    { id: "song", component: "Song", role: "song" },
    { id: "input", component: "Input", variant: "line", placeholder: { path: "/placeholder" } },
  ]),

  // U+tv: light and transparency sit on top of the picture.
  glass: documentFor("glass", [
    {
      id: "root",
      component: "Column",
      fill: true,
      pad: true,
      justify: "center",
      align: "center",
      children: ["panel"],
    },
    {
      id: "panel",
      component: "Glass",
      children: ["stack"],
    },
    {
      id: "stack",
      component: "Column",
      align: "center",
      gap: 16,
      children: ["song", "note", "band", "input"],
    },
    { id: "song", component: "Song", role: "song" },
    { id: "note", component: "Note", role: "note", ellipsizeAt: 90 },
    { id: "band", component: "Band", bandWidth: 360, bandHeight: 36 },
    { id: "input", component: "Input", variant: "line", placeholder: { path: "/placeholder" } },
  ]),

  // iA Writer: the sentence is the page. The song is only a running head.
  page: documentFor("page", [
    {
      id: "root",
      component: "Column",
      fill: true,
      pad: true,
      justify: "center",
      align: "center",
      gap: 28,
      width: 640,
      children: ["song", "note", "input"],
    },
    { id: "song", component: "Song", role: "whisper" },
    { id: "note", component: "Note", role: "display", ellipsizeAt: 280 },
    { id: "input", component: "Input", variant: "line", placeholder: { path: "/placeholder" } },
  ]),
};

export function componentsOf(id: SurfaceId): LyraComponent[] {
  const update = SURFACES[id].find((message) => "updateComponents" in message);
  if (!update || !("updateComponents" in update)) return [];
  return update.updateComponents.components;
}
