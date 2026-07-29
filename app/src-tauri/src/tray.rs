use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use tauri::{
    image::Image,
    tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent, TrayIconId},
    AppHandle, Manager,
};

const TRAY_ID: &str = "lyra-tray";
const BREATH_HALF_CYCLE_MS: u64 = 1600;
const DIM_ALPHA_SCALE: f32 = 0.55;

/// Multiply each pixel's alpha by `scale`, producing a dim RGBA buffer of the
/// same dimensions. Used to prebuild the low-luminance breath frame.
fn dim_rgba(rgba: &[u8], scale: f32) -> Vec<u8> {
    let mut out = rgba.to_vec();
    for pixel in out.chunks_exact_mut(4) {
        pixel[3] = (pixel[3] as f32 * scale).round().clamp(0.0, 255.0) as u8;
    }
    out
}

/// Controller that owns the system-tray icon and a breathing-animation state.
pub struct TrayController {
    /// The Tauri tray-icon handle (held alive for the process lifetime).
    _icon: TrayIcon,
    /// Stable ID used to look the icon up from spawned threads via AppHandle.
    tray_id: TrayIconId,
    /// Cloned handle so the animation thread can call `set_icon` from any thread.
    app: AppHandle,
    /// Pre-decoded bright frame RGBA (owned so the thread can borrow it).
    bright_rgba: Arc<Vec<u8>>,
    /// Pre-decoded dim frame RGBA (owned).
    dim_rgba: Arc<Vec<u8>>,
    icon_w: u32,
    icon_h: u32,
    /// Whether the breathing animation is currently active.
    breathing: Arc<AtomicBool>,
}

impl TrayController {
    /// Build the tray icon and return the controller.
    /// Call this once during `app.setup()`.
    pub fn new(app: &AppHandle) -> tauri::Result<Self> {
        // Load the 32x32 application icon that ships with the bundle.
        let icon_bytes = include_bytes!("../icons/32x32.png");
        let bright = Image::from_bytes(icon_bytes)?;
        let icon_w = bright.width();
        let icon_h = bright.height();
        let bright_rgba: Vec<u8> = bright.rgba().to_vec();
        let dim_bytes = dim_rgba(&bright_rgba, DIM_ALPHA_SCALE);

        let tray_id = TrayIconId::new(TRAY_ID);
        let tray = TrayIconBuilder::with_id(tray_id.clone())
            .icon(bright)
            // macOS system menu-bar icons should follow the template
            // convention so they blend with dark/light appearance.
            .icon_as_template(true)
            .tooltip("Lyra")
            .on_tray_icon_event(|tray, event| {
                // Left-click on the tray icon toggles the main window's
                // visibility. Right-click is left for a future menu.
                if let TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } = event
                {
                    let app = tray.app_handle();
                    if let Some(win) = app.get_webview_window("main") {
                        let visible = win.is_visible().unwrap_or(false);
                        if visible {
                            let _ = win.hide();
                        } else {
                            let _ = win.show();
                            let _ = win.set_focus();
                        }
                    }
                }
            })
            .build(app)?;

        Ok(Self {
            _icon: tray,
            tray_id,
            app: app.clone(),
            bright_rgba: Arc::new(bright_rgba),
            dim_rgba: Arc::new(dim_bytes),
            icon_w,
            icon_h,
            breathing: Arc::new(AtomicBool::new(false)),
        })
    }

    /// Start or stop the breathing animation.
    ///
    /// - `set_breathing(true)` is **idempotent**: calling it while already
    ///   breathing is a no-op (the existing thread keeps running).
    /// - `set_breathing(false)` is also idempotent. When the thread exits it
    ///   restores the bright icon so the tray isn't left visually dimmed.
    pub fn set_breathing(&self, on: bool) {
        if on {
            // Already breathing — don't spawn a second thread.
            if self.breathing.swap(true, Ordering::SeqCst) {
                return;
            }

            let flag = Arc::clone(&self.breathing);
            let app = self.app.clone();
            let tray_id = self.tray_id.clone();
            let bright = Arc::clone(&self.bright_rgba);
            let dim = Arc::clone(&self.dim_rgba);
            let w = self.icon_w;
            let h = self.icon_h;

            std::thread::spawn(move || {
                let mut show_bright = false; // start on dim so the first swap is visible
                while flag.load(Ordering::SeqCst) {
                    let frame: &[u8] = if show_bright { &bright } else { &dim };
                    if let Some(tray) = app.tray_by_id(&tray_id) {
                        let img = Image::new(frame, w, h);
                        let _ = tray.set_icon(Some(img));
                    }
                    show_bright = !show_bright;
                    std::thread::sleep(std::time::Duration::from_millis(
                        BREATH_HALF_CYCLE_MS,
                    ));
                }
                // Restore bright frame so a stopped tray isn't left dim.
                if let Some(tray) = app.tray_by_id(&tray_id) {
                    let img = Image::new(&bright[..], w, h);
                    let _ = tray.set_icon(Some(img));
                }
            });
        } else {
            self.breathing.store(false, Ordering::SeqCst);
        }
    }

    /// Returns true if the animation is currently running.
    pub fn is_breathing(&self) -> bool {
        self.breathing.load(Ordering::SeqCst)
    }
}

// ─── Tauri command wiring ────────────────────────────────────────────────────

use tauri::State;

pub struct TrayState(pub TrayController);

/// Tauri command exposed to the frontend: `invoke("tray_set_breathing", { on })`.
#[tauri::command]
pub async fn tray_set_breathing(
    state: State<'_, TrayState>,
    on: bool,
) -> Result<(), String> {
    state.0.set_breathing(on);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::dim_rgba;

    #[test]
    fn dim_rgba_scales_alpha_only() {
        // Two pixels: opaque red, half-opaque green
        let src: Vec<u8> = vec![255, 0, 0, 255, 0, 255, 0, 128];
        let out = dim_rgba(&src, 0.5);
        // RGB channels unchanged
        assert_eq!(out[0], 255);
        assert_eq!(out[1], 0);
        assert_eq!(out[2], 0);
        assert_eq!(out[4], 0);
        assert_eq!(out[5], 255);
        assert_eq!(out[6], 0);
        // Alpha halved
        assert_eq!(out[3], 128); // 255 * 0.5 → 127.5 → round → 128
        assert_eq!(out[7], 64); // 128 * 0.5 → 64
    }

    #[test]
    fn dim_rgba_preserves_length() {
        let src: Vec<u8> = vec![0; 32 * 32 * 4];
        let out = dim_rgba(&src, 0.55);
        assert_eq!(out.len(), src.len());
    }

    #[test]
    fn dim_rgba_scale_zero_clears_alpha() {
        let src: Vec<u8> = vec![10, 20, 30, 200];
        let out = dim_rgba(&src, 0.0);
        assert_eq!(out[3], 0);
    }
}
