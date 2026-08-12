// dynamic_volume.rs
//
// 动态音量控制器 —— 用键盘活动强度做"外部信号",敲得越多,音乐越轻,
// 反之音乐恢复满音量。禅要求:曲线要平滑,不能 duck 得突兀。
//
// 架构:
//   1. rdev::listen 在后台线程里跑一次(用 Once 幂等),catch 全局 KeyPress
//   2. 事件时间戳放到 5s 滚动窗口
//   3. 500ms ticker 采样窗口内事件数 → EPS → 分段线性 → EMA 平滑 → apply(倍数)
//
// 启停语义:
//   - enable(): 第一次触发线程 spawn(此时 macOS 会弹辅助功能权限请求),
//     后续调用只翻 enabled 标志。listen 线程一旦启动就活到进程结束
//     (rdev 的 listen 是阻塞的,没有 clean shutdown 途径,只能靠 enabled 做门控)。
//   - disable(): 翻 enabled 标志,ticker 线程发现后会以同样的 EMA 曲线把音量
//     慢慢送回 1.0,不会突然弹响。
//
// 权限失败降级:rdev::listen 在未授权时返回 Err。listen 线程打印一条日志就退出,
// ticker 继续跑但事件窗口永远是空,EPS=0,音量维持 1.0 —— 相当于什么都没发生。

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, Once};
use std::thread;
use std::time::{Duration, Instant};

const WINDOW_MS: u64 = 5_000;
const TICK_MS: u64 = 500;
const ALPHA: f32 = 0.15;

pub struct DynamicVolumeController {
    enabled: Arc<AtomicBool>,
    events: Arc<Mutex<Vec<Instant>>>,
    smoothed: Arc<Mutex<f32>>,
    start_once: Arc<Once>,
}

impl Default for DynamicVolumeController {
    fn default() -> Self {
        Self::new()
    }
}

impl DynamicVolumeController {
    pub fn new() -> Self {
        Self {
            enabled: Arc::new(AtomicBool::new(false)),
            events: Arc::new(Mutex::new(Vec::new())),
            smoothed: Arc::new(Mutex::new(1.0)),
            start_once: Arc::new(Once::new()),
        }
    }

    pub fn is_enabled(&self) -> bool {
        self.enabled.load(Ordering::Relaxed)
    }

    /// 启用。第一次调用会 spawn 监听线程 + ticker 线程(通过 Once 保证幂等)。
    /// `apply` 会在 ticker 每 500ms 调一次,收到当前应该应用的音量倍数(0.6..=1.0)。
    /// 传进来的 apply 必须便宜(内部就是 audio_player.set_volume,轻锁 + 单次赋值)。
    pub fn enable<F>(&self, apply: F)
    where
        F: Fn(f32) + Send + 'static,
    {
        self.enabled.store(true, Ordering::Relaxed);
        let events = self.events.clone();
        let enabled = self.enabled.clone();
        let smoothed = self.smoothed.clone();
        self.start_once.call_once(move || {
            // 键盘监听线程 —— rdev::listen 是阻塞的,不能停,只能靠 enabled 做门控
            let events_kb = events.clone();
            let enabled_kb = enabled.clone();
            thread::spawn(move || {
                let result = rdev::listen(move |ev| {
                    if !enabled_kb.load(Ordering::Relaxed) {
                        return;
                    }
                    if let rdev::EventType::KeyPress(_) = ev.event_type {
                        let now = Instant::now();
                        if let Ok(mut e) = events_kb.lock() {
                            e.push(now);
                            let cutoff = now
                                .checked_sub(Duration::from_millis(WINDOW_MS))
                                .unwrap_or(now);
                            e.retain(|&t| t >= cutoff);
                        }
                    }
                });
                // 走到这里说明 rdev listen 出错。最常见原因:macOS 未授予辅助功能权限。
                eprintln!(
                    "[lyra] dynamic_volume: rdev listen exited: {:?} \
                     — 键盘监听不可用,请在系统设置 → 隐私与安全性 → 辅助功能里给 Lyra 打钩。",
                    result
                );
            });

            // Ticker 线程 —— 定期采样活动强度并平滑
            let events_tick = events.clone();
            let smoothed_tick = smoothed.clone();
            let enabled_tick = enabled.clone();
            thread::spawn(move || loop {
                thread::sleep(Duration::from_millis(TICK_MS));
                let target = if enabled_tick.load(Ordering::Relaxed) {
                    let now = Instant::now();
                    let cutoff = now
                        .checked_sub(Duration::from_millis(WINDOW_MS))
                        .unwrap_or(now);
                    let count = {
                        let e = events_tick.lock().unwrap();
                        e.iter().filter(|&&t| t >= cutoff).count()
                    };
                    let eps = count as f32 / (WINDOW_MS as f32 / 1000.0);
                    eps_to_multiplier(eps)
                } else {
                    // disabled 时 target 拉回 1.0,ticker 会用同样的 EMA 慢慢送回,
                    // 相比"立刻 set_volume(1.0)"更符合"不着痕迹"的美学。
                    1.0
                };
                let mut s = smoothed_tick.lock().unwrap();
                *s = *s * (1.0 - ALPHA) + target * ALPHA;
                let m = *s;
                drop(s);
                apply(m);
            });
        });
    }

    pub fn disable(&self) {
        self.enabled.store(false, Ordering::Relaxed);
    }
}

/// EPS(events per second)映射到音量倍数,分段线性:
/// - 0..=1 EPS(几乎不动)  → 1.0 满音量
/// - 10+  EPS(狂敲代码) → 0.6
/// - 中间段线性下降
pub fn eps_to_multiplier(eps: f32) -> f32 {
    if eps <= 1.0 {
        1.0
    } else if eps >= 10.0 {
        0.6
    } else {
        1.0 - (eps - 1.0) / 9.0 * 0.4
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn eps_curve_endpoints_and_monotonic() {
        assert!((eps_to_multiplier(0.0) - 1.0).abs() < 1e-6);
        assert!((eps_to_multiplier(1.0) - 1.0).abs() < 1e-6);
        assert!((eps_to_multiplier(10.0) - 0.6).abs() < 1e-6);
        assert!((eps_to_multiplier(50.0) - 0.6).abs() < 1e-6);
        // 严格单调递减(在中间段)
        assert!(eps_to_multiplier(2.0) > eps_to_multiplier(5.0));
        assert!(eps_to_multiplier(5.0) > eps_to_multiplier(8.0));
    }

    #[test]
    fn eps_curve_never_below_floor() {
        for eps in [0.0, 1.0, 5.0, 10.0, 100.0, 10_000.0].iter() {
            let m = eps_to_multiplier(*eps);
            assert!(m >= 0.6 && m <= 1.0, "eps={} → m={}", eps, m);
        }
    }
}
