'use client';

import { useEffect, useId, useRef, useState } from 'react';
import styles from './inspection-mark.module.css';
import { reviewExamples } from './inspection-code';

function colorCode(text: string) {
  return text.split(/(\b(?:function|const|return|typeof|if|new|null)\b)/g).map((part, index) => (
    <tspan
      key={index}
      className={
        /^(function|const|return|typeof|if|new|null)$/.test(part) ? styles.keyword : undefined
      }
    >
      {part}
    </tspan>
  ));
}

const rows = Array.from({ length: 21 }, (_, index) => {
  const example = reviewExamples[index % reviewExamples.length];
  const period = Math.max(440, Math.max(example.source.length, example.reviewed.length) * 4.8);
  const latitude = ((index - 10) / 10) * 1.24;
  const width = Math.cos(latitude) * 169;
  const y = 205 + Math.sin(latitude) * 169 * 0.95;
  const bend = Math.cos(latitude) * 52;
  return {
    width,
    y,
    bend,
    path: `M${205 - width},${y} Q205,${y - bend} ${205 + width},${y}`,
    period,
    original: colorCode(example.source.repeat(3)),
    edited: colorCode(example.reviewed.repeat(3)),
    reverse: index % 2 === 0,
  };
});

type Point = { x: number; y: number };
const parked = { x: 278, y: 256 };

function nearestRow(point: Point) {
  let closest = 10;
  let distance = Infinity;
  rows.forEach((row, index) => {
    const t = (point.x - (205 - row.width)) / (row.width * 2);
    if (t < 0 || t > 1) return;
    const delta = Math.abs(point.y - (row.y - 2 * row.bend * t * (1 - t)));
    if (delta < distance) {
      closest = index;
      distance = delta;
    }
  });
  return closest;
}

/** A local SVG illustration. The lens reuses the same animated source geometry. */
export function InspectionMark() {
  const id = useId().replace(/:/g, '');
  const figure = useRef<HTMLElement>(null);
  const globe = useRef<SVGSVGElement>(null);
  const lensViewport = useRef<SVGGElement>(null);
  const point = useRef<Point>(parked);
  const pointerFrame = useRef<number | null>(null);
  const selectedRef = useRef(nearestRow(parked));
  const [selectedRow, setSelectedRow] = useState(() => nearestRow(parked));
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [running, setRunning] = useState(false);
  const [reduced, setReduced] = useState(true);
  const [phase, setPhase] = useState<'highlight' | 'edited'>('highlight');
  const inspecting = hovered || focused || pinned;
  const reviewPhase = inspecting ? (reduced ? 'edited' : phase) : 'idle';

  const positionLens = (next: Point) => {
    point.current = next;
    if (pointerFrame.current !== null) return;
    pointerFrame.current = requestAnimationFrame(() => {
      pointerFrame.current = null;
      const target = point.current;
      const bounds = figure.current?.getBoundingClientRect();
      // Keep the fixed handle inside the viewport while still sampling the cursor's code.
      const rightLimit =
        bounds && bounds.width
          ? ((window.innerWidth - 8 - bounds.left) / bounds.width) * 440 - 140
          : 440;
      const displayX = Math.min(target.x, rightLimit);
      figure.current?.style.setProperty('--lens-x', `${displayX / 4.4}%`);
      figure.current?.style.setProperty('--lens-y', `${target.y / 4.4}%`);
      lensViewport.current?.setAttribute(
        'transform',
        `translate(80 80) scale(1.75) translate(${-target.x} ${-target.y})`,
      );
      lensViewport.current?.setAttribute('data-source-x', target.x.toFixed(2));
      lensViewport.current?.setAttribute('data-source-y', target.y.toFixed(2));
      const row = nearestRow(target);
      if (row !== selectedRef.current) {
        selectedRef.current = row;
        setPhase('highlight');
        setSelectedRow(row);
      }
    });
  };

  useEffect(
    () => () => {
      if (pointerFrame.current !== null) cancelAnimationFrame(pointerFrame.current);
    },
    [],
  );

  useEffect(() => {
    const element = figure.current;
    const svg = globe.current;
    if (!element || !svg || typeof svg.pauseAnimations !== 'function') return;
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const viewports = [...element.querySelectorAll('svg')];
    let visible = false;
    let started = false;
    const update = () => {
      const playing = visible && !document.hidden && !preference.matches;
      setReduced(preference.matches);
      if (playing) {
        if (!started) {
          svg.querySelectorAll('animate').forEach((animation) => animation.beginElement());
          started = true;
        }
        viewports.forEach((viewport) => viewport.unpauseAnimations());
      } else viewports.forEach((viewport) => viewport.pauseAnimations());
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
      viewports.forEach((viewport) => viewport.pauseAnimations());
    };
  }, []);

  useEffect(() => {
    if (!inspecting || !running) return;
    let timer: ReturnType<typeof setTimeout>;
    const cycle = () => {
      setPhase('highlight');
      timer = setTimeout(() => {
        setPhase('edited');
        timer = setTimeout(cycle, 3_500);
      }, 900);
    };
    cycle();
    return () => clearTimeout(timer);
  }, [inspecting, running, selectedRow]);

  return (
    <figure
      ref={figure}
      className={styles.scene}
      data-visual="inspection-mark"
      data-inspecting={inspecting}
      data-hovering={hovered}
      data-running={running}
      data-review-phase={reviewPhase}
      aria-label="Illustrative code globe and review magnifier"
      onPointerMove={(event) => {
        if (event.pointerType === 'touch') return;
        const bounds = globe.current?.getBoundingClientRect();
        if (!bounds || !bounds.width) return;
        const next = {
          x: ((event.clientX - bounds.left) / bounds.width) * 440,
          y: ((event.clientY - bounds.top) / bounds.height) * 440,
        };
        const inside = Math.hypot(next.x - 205, next.y - 205) <= 172;
        setHovered(inside);
        if (inside) positionLens(next);
      }}
      onPointerLeave={() => setHovered(false)}
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
        <g id={`${id}-surface`}>
          <g className={styles.sphereRules}>
            <circle cx="205" cy="205" r="170" />
            <ellipse cx="205" cy="205" rx="85" ry="170" transform="rotate(-12 205 205)" />
            <ellipse cx="205" cy="205" rx="145" ry="170" transform="rotate(-12 205 205)" />
          </g>
          <g mask={`url(#${id}-sphere)`} className={styles.codeBands}>
            {rows.map((row, index) => (
              <g
                key={index}
                className={styles.row}
                data-selected={inspecting && index === selectedRow}
              >
                <path d={row.path} className={styles.selection} />
                <text textLength={row.period * 3} lengthAdjust="spacingAndGlyphs">
                  <textPath
                    href={`#${id}-row-${index}`}
                    startOffset={row.reverse ? -row.period : 0}
                  >
                    {reviewPhase === 'edited' && index === selectedRow ? row.edited : row.original}
                    <animate
                      key="motion"
                      attributeName="startOffset"
                      from={row.reverse ? -row.period : 0}
                      to={row.reverse ? 0 : -row.period}
                      dur={`${24 + (index % 4) * 3}s`}
                      repeatCount="indefinite"
                      begin="indefinite"
                    />
                  </textPath>
                </text>
              </g>
            ))}
          </g>
        </g>
      </svg>
      <button
        className={styles.magnifier}
        type="button"
        aria-label="Magnify an illustrative code review"
        aria-describedby={`${id}-caption ${id}-help`}
        aria-pressed={pinned}
        aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight Escape"
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onClick={() => setPinned((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            setPinned(false);
            setHovered(false);
            event.currentTarget.blur();
            return;
          }
          const direction = {
            ArrowLeft: [-12, 0],
            ArrowRight: [12, 0],
            ArrowUp: [0, -12],
            ArrowDown: [0, 12],
          }[event.key];
          if (!direction) return;
          event.preventDefault();
          const next = { x: point.current.x + direction[0], y: point.current.y + direction[1] };
          if (Math.hypot(next.x - 205, next.y - 205) <= 168) positionLens(next);
        }}
      >
        <svg viewBox="0 0 160 160" fill="none" aria-hidden="true">
          <defs>
            <clipPath id={`${id}-lens`}>
              <circle cx="80" cy="80" r="63" />
            </clipPath>
          </defs>
          <g>
            <path className={styles.handleJoint} d="m124 124 21 21" />
            <path
              className={styles.handleBody}
              d="m145 136 46 46q5 5 0 10l-3 3q-5 5-10 0l-46-46z"
            />
            <path className={styles.handleEdge} d="m142 144 42 42" />
          </g>
          <circle data-lens-ring className={styles.bezel} cx="80" cy="80" r="73" />
          <circle className={styles.bezelEdge} cx="80" cy="80" r="70" />
          <circle className={styles.lensFill} cx="80" cy="80" r="65" />
          <g clipPath={`url(#${id}-lens)`}>
            <g
              ref={lensViewport}
              data-lens-viewport
              data-source-x="278"
              data-source-y="256"
              transform="translate(80 80) scale(1.75) translate(-278 -256)"
            >
              <use href={`#${id}-surface`} className={styles.zoomSource} />
            </g>
            <path
              className={styles.reflection}
              d="M24 64a59 59 0 0 1 30-35m-27 44a57 57 0 0 1 2-8"
            />
          </g>
          <circle className={styles.lensRim} cx="80" cy="80" r="64" />
          <g className={styles.bezelTicks}>
            {Array.from({ length: 12 }, (_, index) => (
              <path key={index} d="M80 9v3" transform={`rotate(${index * 30} 80 80)`} />
            ))}
          </g>
        </svg>
      </button>
      <span id={`${id}-help`} className="sr-only">
        Move across the globe to magnify its code, or use arrow keys while the magnifier is focused.
        Click to pin; Escape releases the lens. Changes are illustrative.
      </span>
      <figcaption id={`${id}-caption`} className={styles.caption}>
        Illustrative review · no files changed
      </figcaption>
    </figure>
  );
}
