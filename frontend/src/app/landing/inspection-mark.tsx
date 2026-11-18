'use client';

import { useEffect, useId, useRef, useState } from 'react';
import styles from './inspection-mark.module.css';

const code = [
  'const files = await repository.list();  const source = files.filter(isSource);  ',
  'export function parsePrice(raw) { const price = Number(raw); return price; }  ',
  'const patch = compare(base, head);  const context = graph.neighbors(changed);  ',
  'if (!Number.isFinite(price)) return null;  return Math.max(0, price);  ',
  'type Review = { path: string; line: number; suggestion: string };  ',
  'const changes = pullRequest.files.map(file => inspect(file.patch));  ',
];
const rows = Array.from({ length: 21 }, (_, index) => {
  const latitude = ((index - 10) / 10) * 1.24;
  const width = Math.cos(latitude) * 169;
  const y = 205 + Math.sin(latitude) * 169 * 0.95;
  const bend = Math.cos(latitude) * 52;
  return {
    path: `M${205 - width},${y} Q205,${y - bend} ${205 + width},${y}`,
    text: code[index % code.length].repeat(3),
    reverse: index % 2 === 0,
  };
});

/** A decorative, local SVG illustration. It never reads source or calls a model. */
export function InspectionMark() {
  const id = useId().replace(/:/g, '');
  const figure = useRef<HTMLElement>(null);
  const globe = useRef<SVGSVGElement>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [running, setRunning] = useState(false);
  const inspecting = hovered || focused || pinned;

  useEffect(() => {
    const element = figure.current;
    const svg = globe.current;
    if (!element || !svg || typeof svg.pauseAnimations !== 'function') return;
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    let visible = false;
    let started = false;
    const update = () => {
      const playing = visible && !document.hidden && !preference.matches;
      if (playing) {
        if (!started) {
          svg.querySelectorAll('animate').forEach((animation) => animation.beginElement());
          started = true;
        }
        svg.unpauseAnimations();
      } else svg.pauseAnimations();
      setRunning(playing);
    };
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      update();
    });
    observer.observe(element);
    preference.addEventListener('change', update);
    document.addEventListener('visibilitychange', update);
    update();
    return () => {
      observer.disconnect();
      preference.removeEventListener('change', update);
      document.removeEventListener('visibilitychange', update);
      svg.pauseAnimations();
    };
  }, []);

  return (
    <figure
      ref={figure}
      className={styles.scene}
      data-visual="inspection-mark"
      data-inspecting={inspecting}
      data-running={running}
      aria-label="Illustrative code globe and review magnifier"
    >
      <svg ref={globe} viewBox="0 0 440 440" className={styles.globe} aria-hidden="true">
        <defs>
          <radialGradient id={`${id}-fade`} cx="45%" cy="43%" r="57%">
            <stop offset="0" stopColor="white" />
            <stop offset="0.64" stopColor="white" stopOpacity="0.85" />
            <stop offset="1" stopColor="white" stopOpacity="0.12" />
          </radialGradient>
          <mask id={`${id}-sphere`}>
            <circle cx="205" cy="205" r="170" fill={`url(#${id}-fade)`} />
          </mask>
          {rows.map((row, index) => (
            <path id={`${id}-row-${index}`} d={row.path} key={index} />
          ))}
        </defs>
        <g className={styles.sphereRules}>
          <circle cx="205" cy="205" r="170" />
          <ellipse cx="205" cy="205" rx="85" ry="170" transform="rotate(-12 205 205)" />
          <ellipse cx="205" cy="205" rx="145" ry="170" transform="rotate(-12 205 205)" />
        </g>
        <g mask={`url(#${id}-sphere)`} className={styles.codeBands}>
          {rows.map((row, index) => (
            <text key={index} textLength="1320" lengthAdjust="spacingAndGlyphs">
              <textPath href={`#${id}-row-${index}`} startOffset={row.reverse ? '-440' : '0'}>
                {row.text}
                <animate
                  attributeName="startOffset"
                  from={row.reverse ? '-440' : '0'}
                  to={row.reverse ? '0' : '-440'}
                  dur={`${24 + (index % 4) * 3}s`}
                  repeatCount="indefinite"
                  begin="indefinite"
                />
              </textPath>
            </text>
          ))}
        </g>
      </svg>
      <button
        className={styles.magnifier}
        type="button"
        aria-label="Magnify an illustrative code review"
        aria-describedby={`${id}-caption`}
        aria-pressed={pinned}
        onPointerEnter={(event) => {
          if (event.pointerType !== 'touch') setHovered(true);
        }}
        onPointerLeave={() => setHovered(false)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onClick={() => setPinned((current) => !current)}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return;
          setPinned(false);
          setHovered(false);
          event.currentTarget.blur();
        }}
      >
        <svg viewBox="0 0 204 204" fill="none" aria-hidden="true">
          <defs>
            <clipPath id={`${id}-lens`}>
              <circle cx="80" cy="80" r="65" />
            </clipPath>
          </defs>
          <path className={styles.handle} d="m129 129 57 57" />
          <circle className={styles.lensFill} cx="80" cy="80" r="69" />
          <g clipPath={`url(#${id}-lens)`}>
            <g className={styles.lensCode}>
              <text x="20" y="38">
                parsePrice(raw) {'{'}
              </text>
              <text x="20" y="55">
                const price = Number(raw);
              </text>
              <g className={styles.oldLine} data-review="removed">
                <rect x="0" y="65" width="160" height="17" />
                <text x="20" y="77">
                  return price;
                </text>
              </g>
              <g className={styles.newLines} data-review="inserted">
                <rect x="0" y="64" width="160" height="41" />
                <text x="20" y="77">
                  if (price &lt; 0)
                </text>
                <text x="26" y="94">
                  {' '}
                  return null;
                </text>
              </g>
              <text x="20" y="116" className={styles.returnLine}>
                return price;
              </text>
              <text x="20" y="133">
                {'}'}
              </text>
            </g>
            <path className={styles.reviewCaret} d="M83 82v14" />
          </g>
          <circle className={styles.lensRim} cx="80" cy="80" r="69" />
          <circle className={styles.lensInnerRim} cx="80" cy="80" r="65" />
        </svg>
      </button>
      <figcaption id={`${id}-caption`} className={styles.caption}>
        Illustrative review · no files changed
      </figcaption>
    </figure>
  );
}
