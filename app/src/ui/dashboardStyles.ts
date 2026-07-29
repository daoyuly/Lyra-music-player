/**
 * ui/dashboardStyles.ts — shared visual constants for dashboard panels
 *
 * Emotion / Shift Effectiveness / Rule Trigger panels used to have
 * slightly different padding, border colors, and text opacity. This
 * module centralizes those so future panels stay consistent.
 *
 * Sprint 20 · polish
 */

export const dashboard = {
  // Spacing
  panelPadding: "0.5rem",
  sectionGap: "1rem",
  betweenPanels: "1.5rem",

  // Section divider (between stacked panels inside a dashboard tab)
  sectionDivider: "1px solid rgba(0,0,0,0.1)",
  sectionDividerPadding: "1rem",

  // Card background (summary strip, callout boxes)
  cardBg: "rgba(60, 90, 166, 0.05)",
  cardRadius: "6px",
  cardPadding: "0.75rem",

  // Text
  labelFontSize: "0.7rem",
  bodyFontSize: "0.85rem",
  smallFontSize: "0.75rem",
  headerFontSize: "0.85rem",
  labelOpacity: 0.6,
  headerOpacity: 0.7,
  bodyOpacity: 0.85,

  // Borders (subtle row separators)
  rowBorder: "1px solid rgba(0,0,0,0.05)",
  rowBorderStrong: "1px solid rgba(0,0,0,0.08)",

  // Interactive
  buttonRadius: "4px",
  buttonPadding: "0.35rem 0.75rem",
} as const;

/** Section divider style — used between stacked dashboard panels. */
export const dashboardSectionDivider: React.CSSProperties = {
  marginTop: dashboard.betweenPanels,
  borderTop: dashboard.sectionDivider,
  paddingTop: dashboard.sectionDividerPadding,
};

/** Standard panel header (small caption above a chart or table). */
export const dashboardHeader: React.CSSProperties = {
  fontSize: dashboard.headerFontSize,
  opacity: dashboard.headerOpacity,
  marginBottom: "0.75rem",
};
