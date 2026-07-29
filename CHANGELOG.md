# Changelog

All notable changes to Lyra will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Sprint 20 — Rule Trigger Heatmap
- **Rule visualization**: New `RuleTriggerHeatmap` in the Emotion Dashboard shows which perception rules fire most (bar chart with intensity color gradient).
- Users can now see at a glance which behaviors the system is picking up on (e.g., "跳过频繁", "在场安静").

### Sprint 19 — Audio Feature Wire-up
- **Full audio-aware pipeline**: `Orchestrator` now fetches `libraryFeatures` (bpm/energy/valence extracted from real audio) and passes them to `CompanionAgent`.
- Previously the shiftRanker fell back to metadata heuristics; it now uses actual DSP-extracted features.

### Sprint 18 — Shift Effectiveness Panel
- **Learning visualization**: Bar chart + stats table showing per-shift (接住/点燃/陪着/打断) success rate, sample count, and average listen time.
- Users can see which recommendation strategies work best for them.

### Sprint 17 — Cross-session Shift Learning
- **New table**: `shift_feedback` (migration 008) persists every recommendation + user action.
- **Orchestrator**: writes a `ShiftFeedback` row on every skip/complete.
- **ReflectAgent**: reads last-7-day feedback and includes shift stats in its context.

### Sprint 16 — Emotion Dashboard
- **New tab in Data Explorer**: 情绪仪表盘 with PAD time-series (SVG), trend indicators (↑↓→), volatility, and recent bias reasons.
- **Window selector**: 7d / 30d / 1y views.

### Sprint 15 — Recommendation Wire-up
- **shiftRanker uses real features**: bpm/energy/valence signals refine the shift-affinity score.
- **emotionTimelineFromAudit**: build long-term PAD trajectory from `perception_audit` rows.
- **App.tsx perception tick**: pushes behavioral signals (skipRatio, isBlurred, inputHesitation) to Orchestrator every 60s.

### Sprint 14 — Recommendation Engine
- **shiftLogic**: infer 4 shift types (接住/点燃/陪着/打断) from PAD + behavioral signals.
- **shiftRanker**: score and re-rank candidates by shift affinity.
- **shiftFeedback**: aggregate stats (success rate, avg time) per shift.
- **emotionTimeline**: 7d/30d/1y windows with linear-regression trend detection.
- **CompanionAgent prompt upgrade**: system prompt now educates the LLM on shift types + emotion arc.

### Sprint 13 — Broad Perception Events
- **9 → 13 event kinds**: added scroll / hover_dwell / input_dwell_without_submit / focus_no_interaction.
- **10 → 15 aggregator dimensions**: hoverDwellCount, totalHoverDwellMs, abandonedInputs, focusIdleMs, activityDensity, keyActive/mouseActive splits, weatherCode.
- **5 → 8 rules**: attentive_hover, hesitant_input, quiet_presence added.
- **coarsening**: privacy layer — numeric dims stay local, LLM only sees low/medium/high signals.
- **Weather perception**: Open-Meteo integration for soft PAD bias from local weather.

## Test coverage growth

| Sprint | Total tests |
|--------|-------------|
| Pre-13 baseline | 774 |
| Sprint 14 | 854 |
| Sprint 15 | 875 |
| Sprint 16 | 883 |
| Sprint 17 | 894 |
| Sprint 18 | 901 |
| Sprint 19 | 904 |
| Sprint 20 | 914 |

## Earlier sprints

See `docs/superpowers/plans/` for the full plan history.
