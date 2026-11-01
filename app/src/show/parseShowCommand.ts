export const DEFAULT_SHOW_GUEST = "林";

export type ShowCommand =
  | { kind: "start"; topic: string; guestName: string }
  | { kind: "off" };

/** `/show 题目` opens a hosted segment. `/show 嘉宾 / 题目` names the second
 *  host. `/show off` ends the segment. Anything else is ordinary chat. */
export function parseShowCommand(raw: string): ShowCommand | null {
  const t = raw.trim();
  if (!t.startsWith("/show")) return null;
  const rest = t.slice("/show".length);
  if (rest.length > 0 && !/^\s/.test(rest)) return null;
  const body = rest.trim();
  if (body === "off") return { kind: "off" };
  if (!body) return { kind: "start", topic: "", guestName: DEFAULT_SHOW_GUEST };

  const named = body.match(/^(.+?)\s*\/\s*(.+)$/);
  if (named) {
    const guestName = named[1].trim().slice(0, 12);
    const topic = named[2].trim();
    if (!guestName || !topic) {
      return { kind: "start", topic: body, guestName: DEFAULT_SHOW_GUEST };
    }
    return { kind: "start", topic, guestName };
  }
  return { kind: "start", topic: body, guestName: DEFAULT_SHOW_GUEST };
}
