import type { SpeechMouth } from "../air/mouth";
import { createSystemMouth } from "../air/mouth";
import type { ShowLine } from "./rundown";

/** GLM-TTS 锤锤. Lyra, the other female voice. */
export const LYRA_VOICE = "chuichui";
/** GLM-TTS 小陈. The guest. */
export const GUEST_VOICE = "xiaochen";

export type SpeechRequest = { voice: string; text: string };

export type ShowVoice = {
  speak(lines: ShowLine[]): Promise<void>;
  cancel(): void;
};

export function speechLines(lines: ShowLine[]): SpeechRequest[] {
  return lines
    .map((line) => ({
      voice: line.speaker === "lyra" ? LYRA_VOICE : GUEST_VOICE,
      text: line.text.trim(),
    }))
    .filter((line) => line.text.length > 0);
}

/** Duo-show lines on a shared mouth, so a bulletin can wait its turn. */
export function createShowVoice(mouth: SpeechMouth): ShowVoice {
  return {
    speak(lines) {
      return mouth.speak(speechLines(lines));
    },
    cancel() {
      mouth.cancel();
    },
  };
}

/** GLM-TTS through the Tauri command. Cancel makes the in-flight speak reject. */
export function createSystemShowVoice(): ShowVoice {
  return createShowVoice(createSystemMouth());
}
