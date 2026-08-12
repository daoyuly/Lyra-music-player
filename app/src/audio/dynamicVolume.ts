// 动态音量控制器的前端薄层。真正的键盘监听 + 音量应用都在 Rust 侧
// (see src-tauri/src/dynamic_volume.rs),这里只负责翻开关。
//
// 注意:enable() 第一次触发时,macOS 会弹出"辅助功能权限"请求;
// 用户未授权时 Rust 侧监听线程会静默退出,音量维持 1.0,相当于无操作。

import { invoke } from "@tauri-apps/api/core";

export async function enableDynamicVolume(): Promise<void> {
  await invoke("dynamic_volume_enable");
}

export async function disableDynamicVolume(): Promise<void> {
  await invoke("dynamic_volume_disable");
}

export async function setVolume(volume: number): Promise<void> {
  await invoke("audio_set_volume", { volume });
}
