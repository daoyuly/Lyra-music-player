// HelpOverlay — /help modal. First-person voice: 面向用户默认「我」。
// Opened by the /help slash command in HomeView.
import { useEffect } from "react";

export type HelpOverlayProps = {
  open: boolean;
  onClose: () => void;
};

export function HelpOverlay({ open, onClose }: HelpOverlayProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div
        data-testid="help-backdrop"
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.35)",
          zIndex: 9998,
        }}
      />
      <div
        role="dialog"
        aria-label="Help"
        data-testid="help-overlay"
        className="settings-modal"
        style={{ maxWidth: 520, maxHeight: "80vh", overflowY: "auto" }}
      >
        <h2>与我相处的方式</h2>

        <section>
          <h3 style={sectionTitle}>命令</h3>
          <ul style={list}>
            <li><code>/help</code> — 打开这份说明</li>
            <li><code>/settings</code> — 密钥、曲库、梦时刻、感知开关</li>
            <li><code>/stats</code> — LLM 调用与消耗</li>
            <li><code>/explorer</code> — 数据浏览器（播放记录、Agent runtime、轮次、记忆、灵魂、显著性、LLM 用量…）</li>
            <li><code>/week</code> — 打开我给你写的这一周的信（最近 7 天） · 若数据不足或我这周没写好，会展示一封短的道歉</li>
            <li><code>/reload-musics</code> — 清掉旧曲库记录，从设置里的曲库路径重新扫描 · 用在你重命名/搬动了歌曲之后</li>
          </ul>
          <p style={hint}>
            <code>/settings</code> 里还有一个 <em>Pi Agent（实验性）</em> 开关 —— 打开后 EmotionAgent + CompanionAgent 会走带 tool calling / 事件流的新运行时，出问题关掉即回退。事件流可在 <code>/explorer</code> → Agent runtime 里查看。
          </p>
          <p style={hint}>
            快捷键：<kbd>⌘=</kbd> 设置 · <kbd>⌘⇧D</kbd> 数据浏览器 ·{" "}
            <kbd>⌘⇧E</kbd> Roadmap · <kbd>⌘⇧R</kbd> 现在反思一次 ·{" "}
            <kbd>Space</kbd> 播放 / 暂停
          </p>
        </section>

        <section>
          <h3 style={sectionTitle}>我是谁</h3>
          <p style={para}>
            我是 Lyra，一个陪你说话、替你选一首歌的伙伴。
          </p>
          <p style={para}>
            我的产品设计理念：<em>静 · 虚 · 空 · 灵 · 禅</em>。
          </p>
          <p style={para}>
            我不主动开口——你说话，我才动。<br />
            不占视觉主导，留白优先。<br />
            变化慢到你 30 秒才察觉。<br />
            有自己的品味，也有克制。
          </p>
        </section>

        <section>
          <h3 style={sectionTitle}>怎么和我说话</h3>
          <p style={para}>
            正常说就好。「最近有点累」「想放空一下」「给我一首雨天的」——
            这些对我都够。不用调 prompt，不用喂标签。
          </p>
          <p style={para}>
            我从你的话里读情绪（愉悦度 · 唤起度 · 主导感），
            再从曲库里挑一首合适的，写一行小注告诉你为什么。
            歌听完了会自动接下一首；想换的时候，直接说。
          </p>
        </section>

        <section>
          <h3 style={sectionTitle}>数据在哪里</h3>
          <ul style={list}>
            <li>所有轮次、记忆、灵魂状态都存在<strong>本地 SQLite</strong>（<code>lyra.db</code>）——你的机器，不上传。</li>
            <li>API 密钥存在<strong>系统 keychain</strong>，不落明文文件。</li>
            <li>只有当你输入触发一次对话时，你的话才会发往你在 <code>/settings</code> 里配置的那个模型（Zhipu / DeepSeek / Anthropic 之一）。</li>
            <li>感知模式默认<strong>规则式，完全离线</strong>；LLM 感知需要在 <code>/settings</code> 里主动开启。</li>
            <li>想全清：退出应用，删掉本地数据库文件即可。</li>
          </ul>
        </section>

        <div className="settings-actions">
          <button onClick={onClose} data-testid="help-close">好</button>
        </div>
      </div>
    </>
  );
}

const sectionTitle: React.CSSProperties = {
  fontSize: "0.95rem",
  fontWeight: 500,
  letterSpacing: "0.05em",
  opacity: 0.85,
  margin: "0.5rem 0 0.4rem",
};

const para: React.CSSProperties = {
  margin: "0.35rem 0",
  fontSize: "0.9rem",
  lineHeight: 1.65,
  opacity: 0.88,
};

const list: React.CSSProperties = {
  margin: "0.35rem 0 0.35rem 1.1rem",
  padding: 0,
  fontSize: "0.9rem",
  lineHeight: 1.7,
  opacity: 0.88,
};

const hint: React.CSSProperties = {
  margin: "0.5rem 0 0",
  fontSize: "0.8rem",
  opacity: 0.6,
};
