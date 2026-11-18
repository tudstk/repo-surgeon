import styles from './circuit-field.module.css';

const tracks = [
  'M-80 76H280l48 48h264l40-40h360l48 48h480',
  'M-80 180H120l44 44h300l44-44h340l48 48h624',
  'M-80 292H248l44-44h312l44 44h292l48-48h532',
  'M-80 396H88l48-48h304l48 48h304l48-48h352l48 48h280',
  'M-80 496H304l48-48h304l48 48h288l48-48h480',
  'M-80 600H152l48-48h300l48 48h312l48-48h352l48 48h212',
  'M128-80v248l48 48v240l-48 48v216',
  'M352-80v184l-48 48v240l48 48v280',
  'M576-80v264l-48 48v224l48 48v216',
  'M800-80v192l48 48v232l-48 48v280',
  'M1024-80v264l48 48v224l-48 48v216',
  'M1248-80v192l-48 48v232l48 48v280',
];

export function CircuitField({ vignette = false }: { vignette?: boolean }) {
  return (
    <div
      className={`${styles.field} ${vignette ? styles.vignette : ''}`}
      data-visual="circuit-field"
      data-motion="static"
    >
      <svg viewBox="0 0 1440 640" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <g className={styles.tracks}>
          {tracks.map((track) => (
            <path key={track} d={track} vectorEffect="non-scaling-stroke" />
          ))}
        </g>
      </svg>
    </div>
  );
}
