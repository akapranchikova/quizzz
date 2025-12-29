interface Props {
  accent?: string;
  tense?: boolean;
  pulseKey?: number;
}

export default function ScreenBackground({ accent, tense, pulseKey }: Props) {
  return (
    <div className={`screen-bg ${tense ? 'screen-bg--tense' : ''}`} style={{ ['--accent' as string]: accent || '#6366f1' }}>
      <div className="screen-gradient" />
      <div className="screen-gradient screen-gradient--accent" key={pulseKey} />
      <div className="screen-noise" />
      <div className="screen-particles">
        {Array.from({ length: 18 }).map((_, idx) => (
          <span key={idx} style={{ ['--i' as string]: idx + 1 }} />
        ))}
      </div>
    </div>
  );
}
