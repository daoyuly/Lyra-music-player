import { forwardRef } from 'react';
import { FOOTER } from '../copy/ledger';

const buttonStyle: React.CSSProperties = {
  display: 'inline-block',
  padding: '10px 24px',
  borderRadius: 22,
  border: '1px solid rgba(0, 0, 0, 0.15)',
  background: 'rgba(255, 255, 255, 0.5)',
  backdropFilter: 'blur(20px)',
  color: 'var(--text-color)',
  textDecoration: 'none',
  fontSize: 14,
  transition: 'background var(--motion-fast) var(--ease-out)',
};

export const Footer = forwardRef<HTMLElement>((_, ref) => (
  <section ref={ref}>
    <div style={{ textAlign: 'center', maxWidth: 640 }}>
      <p style={{
        fontFamily: 'var(--font-serif-italic)', fontStyle: 'italic',
        fontSize: 24, color: 'var(--text-color-soft)', margin: '0 0 40px',
      }}>
        {FOOTER.tagline}
      </p>
      <div style={{ display: 'flex', gap: 16, justifyContent: 'center', flexWrap: 'wrap' }}>
        {(['mac', 'win', 'linux'] as const).map((k) => (
          <a key={k} href={FOOTER.releasesUrl} target="_blank" rel="noopener noreferrer" style={buttonStyle}>
            {FOOTER.downloads[k]}
          </a>
        ))}
      </div>
      <p style={{ marginTop: 32, fontSize: 13, color: 'var(--text-color-dim)' }}>
        {FOOTER.early}
      </p>
      <p style={{ marginTop: 48, fontSize: 13, display: 'flex', gap: 20, justifyContent: 'center' }}>
        <a href={FOOTER.guideUrl}
           style={{ color: 'var(--text-color-dim)', textDecoration: 'none' }}>
          {FOOTER.guideLabel}
        </a>
        <a href={FOOTER.githubUrl} target="_blank" rel="noopener noreferrer"
           style={{ color: 'var(--text-color-dim)', textDecoration: 'none' }}>
          GitHub
        </a>
      </p>
    </div>
  </section>
));
Footer.displayName = 'Footer';
