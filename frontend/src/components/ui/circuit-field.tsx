'use client';

import { useEffect, useRef, useState } from 'react';
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
  const fieldRef = useRef<HTMLDivElement>(null);
  const tracksRef = useRef<SVGGElement>(null);
  const pulseRef = useRef<SVGGElement>(null);
  const lastTrack = useRef(-1);
  const [paused, setPaused] = useState(false);
  const [environment, setEnvironment] = useState({
    reduced: true,
    visible: false,
    foreground: false,
  });
  const playing = !paused && !environment.reduced && environment.visible && environment.foreground;

  useEffect(() => {
    const field = fieldRef.current;
    if (
      !field ||
      typeof window.matchMedia !== 'function' ||
      typeof IntersectionObserver !== 'function' ||
      typeof Element.prototype.animate !== 'function'
    )
      return;
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updatePreference = () =>
      setEnvironment((current) => ({ ...current, reduced: preference.matches }));
    const updateVisibility = () =>
      setEnvironment((current) => ({ ...current, foreground: !document.hidden }));
    updatePreference();
    updateVisibility();
    preference.addEventListener('change', updatePreference);
    document.addEventListener('visibilitychange', updateVisibility);
    const observer = new IntersectionObserver(([entry]) => {
      setEnvironment((current) => ({ ...current, visible: entry.isIntersecting }));
    });
    observer.observe(field);
    return () => {
      preference.removeEventListener('change', updatePreference);
      document.removeEventListener('visibilitychange', updateVisibility);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    const group = pulseRef.current;
    if (!playing || !group) return;
    const paths = [...group.querySelectorAll('path')];
    if (paths.some((path) => typeof path.animate !== 'function')) return;
    let timer: ReturnType<typeof setTimeout>;
    let animations: Animation[] = [];
    let disposed = false;

    const fire = () => {
      if (disposed) return;
      // Pick a visible route without immediately repeating it. The SVG crops on phones.
      const bounds = fieldRef.current?.getBoundingClientRect();
      const visibleTracks = [...(tracksRef.current?.querySelectorAll('path') ?? [])].flatMap(
        (path, index) => {
          const route = path.getBoundingClientRect();
          return bounds &&
            route.right > bounds.left &&
            route.left < bounds.right &&
            route.bottom > bounds.top &&
            route.top < bounds.bottom
            ? [index]
            : [];
        },
      );
      const choices = visibleTracks.filter((index) => index !== lastTrack.current);
      lastTrack.current =
        choices[Math.floor(Math.random() * choices.length)] ?? visibleTracks[0] ?? 0;
      group.style.color = Math.random() < 0.3 ? 'var(--signal, #f47b68)' : 'var(--accent)';
      const duration = 950 + Math.random() * 500;
      const direction = Math.random() < 0.5 ? 1 : -1;
      const offsets = [0, 40, 70];
      animations = paths.map((path, layer) => {
        path.setAttribute('d', tracks[lastTrack.current]);
        const shift = offsets[layer] * direction;
        return path.animate(
          [
            { strokeDashoffset: `${1000 * direction - shift}`, opacity: 0 },
            {
              strokeDashoffset: `${900 * direction - shift}`,
              opacity: [0.14, 0.36, 0.9][layer],
              offset: 0.1,
            },
            {
              strokeDashoffset: `${100 * direction - shift}`,
              opacity: [0.14, 0.36, 0.9][layer],
              offset: 0.9,
            },
            { strokeDashoffset: `${-shift}`, opacity: 0 },
          ],
          { duration, easing: 'linear' },
        );
      });
      timer = setTimeout(() => {
        animations.forEach((animation) => animation.cancel());
        timer = setTimeout(fire, 1800 + Math.random() * 2600);
      }, duration);
    };
    timer = setTimeout(fire, 1200 + Math.random() * 1000);
    return () => {
      disposed = true;
      clearTimeout(timer);
      animations.forEach((animation) => animation.cancel());
    };
  }, [playing]);

  return (
    <div
      ref={fieldRef}
      className={`${styles.field} ${vignette ? styles.vignette : ''}`}
      data-visual="circuit-field"
      data-motion={
        environment.reduced ? 'reduced' : paused ? 'paused' : playing ? 'playing' : 'idle'
      }
    >
      <svg viewBox="0 0 1440 640" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <g ref={tracksRef} className={styles.tracks}>
          {tracks.map((track) => (
            <path key={track} d={track} vectorEffect="non-scaling-stroke" />
          ))}
        </g>
        <g ref={pulseRef} className={styles.pulse}>
          {[84, 34, 7].map((length) => (
            <path
              key={length}
              d={tracks[0]}
              pathLength="1000"
              strokeDasharray={`${length} ${1000 - length}`}
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </g>
      </svg>
      {!environment.reduced ? (
        <button
          type="button"
          className={styles.motionControl}
          aria-label={paused ? 'Resume background motion' : 'Pause background motion'}
          aria-pressed={paused}
          onClick={() => setPaused((current) => !current)}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d={paused ? 'm5 3 7 5-7 5Z' : 'M5 3v10M11 3v10'} />
          </svg>
          {paused ? 'Resume motion' : 'Pause motion'}
        </button>
      ) : null}
    </div>
  );
}
