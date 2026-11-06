'use client';

import { useRef } from 'react';
import styles from './landing.module.css';

export function FaultTitle() {
  const ref = useRef<HTMLHeadingElement>(null);
  return (
    <h1
      id="landing-title"
      className={styles.headline}
      ref={ref}
      onPointerMove={(event) => {
        if (
          event.pointerType !== 'mouse' ||
          window.matchMedia('(prefers-reduced-motion: reduce)').matches
        )
          return;
        const bounds = event.currentTarget.getBoundingClientRect();
        const shift = ((event.clientY - bounds.top) / bounds.height - 0.5) * 8;
        ref.current?.style.setProperty('--fault-shift', `${Math.max(-4, Math.min(4, shift))}%`);
      }}
      onPointerLeave={() => ref.current?.style.removeProperty('--fault-shift')}
    >
      <span className={styles.titleLayer}>
        <span>CODE HAS</span>
        <span>FAULT LINES.</span>
      </span>
      <span aria-hidden="true" className={`${styles.titleLayer} ${styles.fracture}`}>
        <span>CODE HAS</span>
        <span>FAULT LINES.</span>
      </span>
    </h1>
  );
}
