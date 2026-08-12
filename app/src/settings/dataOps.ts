import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";

/**
 * exportAllData — opens a native save dialog, then calls the Rust
 * `data_export` command to write all tables to the chosen path as JSON.
 *
 * Returns the path chosen by the user and the byte size of the written file.
 * Throws if the user cancels or the export command fails.
 */
export async function exportAllData(): Promise<{ path: string; size: number }> {
  const path = await save({
    title: "导出 Lyra 数据",
    defaultPath: `lyra-export-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: "JSON", extensions: ["json"] }],
  });

  if (!path) {
    throw new Error("Export cancelled");
  }

  const size = await invoke<number>("data_export", { targetPath: path });
  return { path, size };
}

/**
 * wipeAllData — calls the Rust `data_wipe` command which deletes all user
 * data tables and recreates them empty via the migration runner on next open.
 *
 * The caller is responsible for the double-confirm guard before calling this.
 */
export async function wipeAllData(): Promise<void> {
  await invoke("data_wipe");
}
