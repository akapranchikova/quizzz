export default function ScreenBackground() {
  return (
    <div className="screen-bg">
      <div className="screen-gradient" />
      <div className="screen-noise" />
      <div className="screen-particles">
        {Array.from({ length: 18 }).map((_, idx) => (
          <span key={idx} style={{ ['--i' as string]: idx + 1 }} />
        ))}
      </div>
    </div>
  );
}
