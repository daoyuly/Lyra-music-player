import { useEffect, useState } from "react";

export type SmallNoteProps = {
  text: string;
  ellipsizeAt?: number;
  autoCollapseMs?: number;
  color?: string;
  size?: string;
  maxWidth?: string;
};

export function SmallNote({
  text,
  ellipsizeAt = 40,
  autoCollapseMs = 8_000,
  color,
  size,
  maxWidth,
}: SmallNoteProps) {
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!expanded) return;
    const id = setTimeout(() => setExpanded(false), autoCollapseMs);
    return () => clearTimeout(id);
  }, [expanded, autoCollapseMs]);

  const isLong = text.length > ellipsizeAt;
  const display = !isLong || expanded ? text : text.slice(0, ellipsizeAt) + "…";

  return (
    <div
      data-testid="small-note"
      data-lyra-hover="small_note"
      onClick={() => isLong && setExpanded((e) => !e)}
      style={{
        color: color ?? "var(--lyra-color-small-note)",
        fontSize: size ?? "var(--lyra-note-font-size)",
        fontFamily: "var(--lyra-note-family)",
        fontStyle: "italic",
        textAlign: "center",
        maxWidth: maxWidth ?? "var(--lyra-cover-size)",
        cursor: isLong ? "pointer" : "default",
        lineHeight: 1.7,
        transition: "var(--lyra-transition-note-height)",
        whiteSpace: "pre-wrap",
        userSelect: "none",
      }}
    >
      {display}
    </div>
  );
}
