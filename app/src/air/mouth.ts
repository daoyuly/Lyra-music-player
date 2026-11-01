import { invoke } from "@tauri-apps/api/core";

/** One sentence for the synthesizer. Voice is a vendor id, not a role. */
export type SpeechLine = { voice: string; text: string };

/**
 * The single microphone. Show dialogue and bulletins share one, so a
 * later line waits and cancel stops whatever is queued.
 */
export type SpeechMouth = {
  speak(lines: SpeechLine[]): Promise<void>;
  cancel(): void;
};

type SpeechSink = {
  speak(lines: SpeechLine[]): Promise<void>;
  cancel(): void;
};

export function createSpeechMouth(sink: SpeechSink): SpeechMouth {
  let epoch = 0;
  // Holds the mic until the in-flight speak returns, even after cancel,
  // so a new line cannot start while the previous request is still closing.
  let pending: Promise<void> = Promise.resolve();

  return {
    speak(lines) {
      const mine = epoch;
      const audible = lines.filter((line) => line.text.trim().length > 0);
      const run = pending.then(async () => {
        if (mine !== epoch) throw new Error("cancelled");
        if (audible.length === 0) return;
        await sink.speak(audible);
        if (mine !== epoch) throw new Error("cancelled");
      });
      pending = run.catch(() => {});
      return run;
    },
    cancel() {
      epoch += 1;
      sink.cancel();
    },
  };
}

/** GLM-TTS through the Tauri command. Cancel rejects the in-flight speak. */
export function createSystemMouth(): SpeechMouth {
  return createSpeechMouth({
    speak: (lines) => invoke("tts_speak", { lines }),
    cancel: () => {
      void invoke("tts_cancel").catch(() => {});
    },
  });
}
