export type SongInfoProps = {
  title: string;
  artist: string;
  fontSize?: string;
  maxWidth?: string;
};

export function SongInfo({ title, artist, fontSize, maxWidth }: SongInfoProps) {
  const t = title.trim();
  const a = artist.trim();
  const text = t
    ? a
      ? `《${t}》 · ${a}`
      : `《${t}》`
    : ""; // completely empty — parent decides whether to render
  return (
    <div
      data-testid="song-info"
      style={{
        color: "var(--lyra-color-song-info)",
        fontSize: fontSize ?? "var(--lyra-song-font-size)",
        fontFamily: "var(--lyra-song-family)",
        textAlign: "center",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        maxWidth: maxWidth ?? "var(--lyra-cover-size)",
        minHeight: "1.4em",
        lineHeight: 1.6,
        letterSpacing: "0.02em",
      }}
    >
      {text}
    </div>
  );
}
