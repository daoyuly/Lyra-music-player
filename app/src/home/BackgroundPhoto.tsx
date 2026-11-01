import { SESSION_BG, vignetteGradient } from "./bgManifest";

export type BackgroundPhotoProps = {
  /** Override for tests. */
  urlOverride?: string | null;
  position?: string;
  vignette?: number;
};

export function BackgroundPhoto({
  urlOverride,
  position,
  vignette,
}: BackgroundPhotoProps = {}) {
  const url = urlOverride ?? SESSION_BG?.url ?? null;
  if (!url) return null;
  const backgroundPosition = position ?? SESSION_BG?.position ?? "center";
  const vignetteStrength = vignette ?? SESSION_BG?.vignette ?? 0.35;

  return (
    <>
      <div
        data-testid="bg-photo"
        style={{
          position: "fixed",
          inset: 0,
          backgroundImage: `url(${url})`,
          backgroundSize: "cover",
          backgroundPosition,
          zIndex: 0,
          pointerEvents: "none",
        }}
      />
      <div
        data-testid="bg-photo-vignette"
        style={{
          position: "fixed",
          inset: 0,
          background: vignetteGradient(vignetteStrength),
          zIndex: 0,
          pointerEvents: "none",
        }}
      />
    </>
  );
}
