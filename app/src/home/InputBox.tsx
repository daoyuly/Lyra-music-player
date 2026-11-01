import { useState, useCallback, useRef, useEffect } from "react";
import { useInputDwellBus } from "../perception/useInputDwellBus";
import { bus as perceptionBus } from "../perception/events";

const DEFAULT_PLACEHOLDER = "和 Lyra 说点什么…";

export type InputBoxProps = {
  placeholder?: string;
  onSubmit: (text: string) => void;
  disabled?: boolean;
  /** Empty Enter submits "" — used when a show is waiting to start the song. */
  allowEmptySubmit?: boolean;
  /** Grab keyboard focus on mount. Default true — otherwise Tauri users have
   *  to click the textarea before their first keystroke registers. */
  autoFocus?: boolean;
};

export function InputBox({
  placeholder = DEFAULT_PLACEHOLDER,
  onSubmit,
  disabled = false,
  allowEmptySubmit = false,
  autoFocus = true,
}: InputBoxProps) {
  const [value, setValue] = useState("");
  const { notifySubmit } = useInputDwellBus(perceptionBus, value);
  const ref = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!autoFocus || disabled) return;
    // Defer to next tick so the Tauri window's initial layout / focus events
    // settle before we claim keyboard focus. Without this the OS chrome
    // sometimes wins the initial focus race and typing lands nowhere.
    const t = setTimeout(() => ref.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [autoFocus, disabled]);

  const handleKey = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (disabled) return;
      if (e.key !== "Enter" || e.shiftKey) return;
      e.preventDefault();
      const text = value.trim();
      if (!text && !allowEmptySubmit) return;
      onSubmit(text);
      notifySubmit();
      setValue("");
    },
    [value, onSubmit, disabled, allowEmptySubmit, notifySubmit],
  );

  return (
    <div
      style={{
        position: "relative",
        zIndex: 2,
        width: "var(--lyra-input-max-width)",
        maxWidth: 800,
        height: "var(--lyra-input-height)",
      }}
    >
      {/* 模糊放在框背后。毛玻璃直接加在 textarea 上时，系统窗口里字画不出来。 */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: "var(--lyra-input-radius)",
          background: "var(--lyra-color-input-bg)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          boxShadow: "0 1px 0 0 rgba(0,0,0,0.05), inset 0 0 0 1px rgba(0,0,0,0.03)",
          pointerEvents: "none",
        }}
      />
      <textarea
        ref={ref}
        data-testid="lyra-input"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKey}
        placeholder={placeholder}
        disabled={disabled}
        rows={1}
        style={{
          position: "relative",
          zIndex: 1,
          width: "100%",
          height: "100%",
          margin: 0,
          padding: "0 20px",
          lineHeight: "var(--lyra-input-height)",
          borderRadius: "var(--lyra-input-radius)",
          border: "none",
          outline: "none",
          resize: "none",
          overflow: "hidden",
          background: "transparent",
          fontFamily: "var(--lyra-song-family)",
          fontSize: "var(--lyra-song-font-size)",
          color: "var(--lyra-color-song-info)",
          caretColor: "rgba(0, 0, 0, 0.72)",
          display: "block",
        }}
      />
    </div>
  );
}
