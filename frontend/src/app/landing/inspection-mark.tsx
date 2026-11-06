import styles from './landing.module.css';

export function InspectionMark() {
  return (
    <svg
      viewBox="0 0 420 340"
      fill="none"
      className={styles.inspectionMark}
      data-visual="inspection-mark"
      aria-hidden="true"
    >
      <g className={styles.markGuides} strokeWidth="1">
        <path d="M44 56h332M44 284h332M96 24v292M324 24v292" />
        <path d="M40 52l8 8m0-8-8 8m332-8 8 8m0-8-8 8M40 280l8 8m0-8-8 8m332-8 8 8m0-8-8 8" />
        <path d="M210 24v16m0 260v16M44 170h16m300 0h16" />
      </g>
      <g className={styles.markBoundary} strokeWidth="1.5">
        <path d="M132 76h-16v188h16m156-188h16v188h-16" />
        <path d="M152 92h-20v156h20m116-156h20v156h-20" />
      </g>
      <g className={styles.markSource} strokeWidth="1.5">
        <path d="M170 112h58l24 24v92h-82z" />
        <path d="M228 112v24h24M186 156h38m-38 14h50m-50 14h28m-28 14h44" />
        <path d="M157 143h-7v62h7m108-62h7v62h-7" />
      </g>
      <g className={styles.scanLine} strokeWidth="1.5">
        <path d="M72 178h276" />
        <path d="M72 174v8m276-8v8" />
        <rect x="301" y="175" width="6" height="6" fill="currentColor" stroke="none" />
      </g>
    </svg>
  );
}
