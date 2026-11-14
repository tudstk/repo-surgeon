import styles from './landing.module.css';

export function InspectionMark() {
  return (
    <svg
      viewBox="140 88 140 164"
      fill="none"
      className={styles.inspectionMark}
      data-visual="inspection-mark"
      aria-hidden="true"
    >
      <g className={styles.markSource} strokeWidth="1.5">
        <path d="M170 112h58l24 24v92h-82z" />
        <path d="M228 112v24h24M186 156h38m-38 14h50m-50 14h28m-28 14h44" />
      </g>
    </svg>
  );
}
