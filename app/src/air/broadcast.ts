import { GUEST_VOICE, LYRA_VOICE } from "../show/voices";
import type { SpeechLine, SpeechMouth } from "./mouth";
import type { AirRole, Bulletin } from "./bulletin";

const ROLE_VOICE: Record<AirRole, string> = {
  lyra: LYRA_VOICE,
  guest: GUEST_VOICE,
};

export type Broadcaster = {
  air(bulletin: Bulletin): Promise<void>;
  cancel(): void;
};

export function bulletinSpeech(bulletin: Bulletin): SpeechLine[] {
  return bulletin.lines
    .map((line) => ({
      voice: ROLE_VOICE[line.role],
      text: line.text.trim(),
    }))
    .filter((line) => line.text.length > 0);
}

/** Speaks a bulletin on the shared mouth. Show dialogue uses that same mouth. */
export function createBroadcaster(mouth: SpeechMouth): Broadcaster {
  return {
    air(bulletin) {
      const lines = bulletinSpeech(bulletin);
      if (lines.length === 0) return Promise.resolve();
      return mouth.speak(lines);
    },
    cancel() {
      mouth.cancel();
    },
  };
}
