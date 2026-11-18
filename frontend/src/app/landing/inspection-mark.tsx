'use client';

import { useEffect, useId, useRef } from 'react';
import {
  createGlobeRenderer,
  globeRows,
  nearestRow,
  parked,
  type GlobePoint,
} from './inspection-renderer';
import styles from './inspection-mark.module.css';

type Controls = {
  pointer(x: number, y: number, type: string): void;
  leave(): void;
  focus(value: boolean): void;
  togglePin(): void;
  release(): void;
  nudge(x: number, y: number): void;
};

/** Cached drawing is shared by the globe and lens; pointer motion never renders React. */
export function InspectionMark() {
  const id = useId().replace(/:/g, '');
  const figure = useRef<HTMLElement>(null);
  const globe = useRef<HTMLCanvasElement>(null);
  const lens = useRef<HTMLCanvasElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const controls = useRef<Controls | null>(null);

  useEffect(() => {
    const element = figure.current;
    const main = globe.current;
    const zoom = lens.current;
    const trigger = button.current;
    if (!element || !main || !zoom || !trigger) return;
    const style = getComputedStyle(element);
    const renderer = createGlobeRenderer(main, zoom, {
      accent: style.getPropertyValue('--accent').trim(),
      gray: style.getPropertyValue('--code-gray').trim(),
      font: style.getPropertyValue('--font-mono').trim() || 'monospace',
    });
    if (!renderer) return;
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    let visible = false;
    let running = false;
    let hovered = false;
    let focused = false;
    let pinned = false;
    let disposed = false;
    let frame: number | null = null;
    let previous = 0;
    let elapsed = 0;
    let point: GlobePoint = parked;
    let selected = nearestRow(point);
    let selectedAt = 0;
    let poseDirty = true;
    let bounds: DOMRect | null = null;
    const attribute = (node: Element, name: string, value: string) => {
      if (node.getAttribute(name) !== value) node.setAttribute(name, value);
    };
    const invalidate = () => {
      if (!disposed && frame === null) frame = requestAnimationFrame(draw);
    };
    const inspect = () => hovered || focused || pinned;
    const reflect = () => {
      attribute(element, 'data-inspecting', String(inspect()));
      attribute(element, 'data-hovering', String(hovered));
      attribute(trigger, 'aria-pressed', String(pinned));
    };
    function draw(now: number) {
      frame = null;
      if (disposed) return;
      if (running && previous) elapsed += now - previous;
      previous = running ? now : 0;
      const row = nearestRow(point);
      if (row !== selected) {
        selected = row;
        selectedAt = elapsed;
      }
      const phase = !inspect()
        ? 'idle'
        : preference.matches || (elapsed - selectedAt) % 4400 >= 900
          ? 'edited'
          : 'highlight';
      if (poseDirty) {
        bounds ??= main!.getBoundingClientRect();
        const rightLimit = bounds.width
          ? ((window.innerWidth - 8 - bounds.left) / bounds.width) * 440 - 140
          : 440;
        element!.style.setProperty('--lens-x', `${Math.min(point.x, rightLimit) / 4.4}%`);
        element!.style.setProperty('--lens-y', `${point.y / 4.4}%`);
        attribute(zoom!, 'data-source-x', point.x.toFixed(2));
        attribute(zoom!, 'data-source-y', point.y.toFixed(2));
        poseDirty = false;
      }
      attribute(element!, 'data-review-phase', phase);
      attribute(main!, 'data-offset-right', ((elapsed / 1000) * globeRows[0].speed).toFixed(2));
      attribute(main!, 'data-offset-left', ((-elapsed / 1000) * globeRows[1].speed).toFixed(2));
      renderer!.draw({ elapsed, point, selected, phase, inspecting: inspect() });
      if (running) invalidate();
    }
    const environment = () => {
      running = visible && !document.hidden && !preference.matches;
      previous = 0;
      attribute(element, 'data-running', String(running));
      if (frame !== null) {
        cancelAnimationFrame(frame);
        frame = null;
      }
      if (visible && !document.hidden) invalidate();
    };
    const geometry = () => {
      bounds = null;
      poseDirty = true;
      renderer.resize();
      if (visible) invalidate();
    };
    const move = (next: GlobePoint) => {
      point = next;
      poseDirty = true;
      invalidate();
    };
    controls.current = {
      pointer(x, y, type) {
        if (type === 'touch') return;
        bounds ??= main.getBoundingClientRect();
        if (!bounds.width) return;
        const next = {
          x: ((x - bounds.left) / bounds.width) * 440,
          y: ((y - bounds.top) / bounds.height) * 440,
        };
        const inside = Math.hypot(next.x - 205, next.y - 205) <= 172;
        if (hovered !== inside) {
          hovered = inside;
          selectedAt = elapsed;
          reflect();
          invalidate();
        }
        if (inside) move(next);
      },
      leave() {
        hovered = false;
        reflect();
        invalidate();
      },
      focus(value) {
        focused = value;
        selectedAt = elapsed;
        reflect();
        invalidate();
      },
      togglePin() {
        pinned = !pinned;
        reflect();
        invalidate();
      },
      release() {
        hovered = focused = pinned = false;
        reflect();
        invalidate();
      },
      nudge(x, y) {
        const next = { x: point.x + x, y: point.y + y };
        if (Math.hypot(next.x - 205, next.y - 205) <= 168) move(next);
      },
    };
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      environment();
    });
    observer.observe(element);
    const resize = new ResizeObserver(geometry);
    resize.observe(element);
    if (element.parentElement?.parentElement) resize.observe(element.parentElement.parentElement);
    preference.addEventListener('change', environment);
    document.addEventListener('visibilitychange', environment);
    window.addEventListener('scroll', geometry, { passive: true, capture: true });
    window.addEventListener('resize', geometry);
    attribute(element, 'data-ready', 'true');
    invalidate();
    return () => {
      disposed = true;
      controls.current = null;
      if (frame !== null) cancelAnimationFrame(frame);
      observer.disconnect();
      resize.disconnect();
      preference.removeEventListener('change', environment);
      document.removeEventListener('visibilitychange', environment);
      window.removeEventListener('scroll', geometry, true);
      window.removeEventListener('resize', geometry);
    };
  }, []);

  return (
    <figure
      ref={figure}
      className={styles.scene}
      data-visual="inspection-mark"
      data-inspecting="false"
      data-hovering="false"
      data-running="false"
      data-review-phase="idle"
      data-ready="false"
      aria-label="Illustrative code globe and review magnifier"
      onPointerMove={(event) =>
        controls.current?.pointer(event.clientX, event.clientY, event.pointerType)
      }
      onPointerLeave={() => controls.current?.leave()}
    >
      <canvas
        ref={globe}
        width="880"
        height="880"
        className={styles.globe}
        data-globe-canvas
        aria-hidden="true"
      />
      <svg viewBox="0 0 440 440" className={styles.fallback} aria-hidden="true">
        <circle cx="205" cy="205" r="170" />
        <ellipse cx="205" cy="205" rx="85" ry="170" />
        <text x="70" y="180">
          function parsePrice(raw) {'{'}
        </text>
        <text x="70" y="205">
          {' '}
          const price = Number(raw);
        </text>
        <text x="70" y="230">
          {' '}
          return price;
        </text>
        <text x="70" y="255">
          {'}'}
        </text>
      </svg>
      <button
        ref={button}
        className={styles.magnifier}
        type="button"
        aria-label="Magnify an illustrative code review"
        aria-describedby={`${id}-caption ${id}-help`}
        aria-pressed="false"
        aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight Escape"
        onFocus={() => controls.current?.focus(true)}
        onBlur={() => controls.current?.focus(false)}
        onClick={() => controls.current?.togglePin()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            controls.current?.release();
            event.currentTarget.blur();
            return;
          }
          const direction = {
            ArrowLeft: [-12, 0],
            ArrowRight: [12, 0],
            ArrowUp: [0, -12],
            ArrowDown: [0, 12],
          }[event.key];
          if (direction) {
            event.preventDefault();
            controls.current?.nudge(direction[0], direction[1]);
          }
        }}
      >
        <svg viewBox="0 0 160 160" fill="none" aria-hidden="true">
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
          <circle className={styles.lensRim} cx="80" cy="80" r="64" />
          <g className={styles.bezelTicks}>
            {Array.from({ length: 12 }, (_, index) => (
              <path key={index} d="M80 9v3" transform={`rotate(${index * 30} 80 80)`} />
            ))}
          </g>
        </svg>
        <canvas
          ref={lens}
          width="252"
          height="252"
          className={styles.lensCanvas}
          data-lens-viewport
          data-source-x="278"
          data-source-y="256"
          aria-hidden="true"
        />
        <svg viewBox="0 0 160 160" className={styles.lensShine} aria-hidden="true">
          <path className={styles.reflection} d="M24 64a59 59 0 0 1 30-35m-27 44a57 57 0 0 1 2-8" />
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
