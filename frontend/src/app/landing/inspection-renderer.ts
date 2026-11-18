import { reviewExamples } from './inspection-code';

export type GlobePoint = { x: number; y: number };
export const parked = { x: 278, y: 256 };
const textureScale = 4;
const textureHeight = 13;
const baseline = 10;

type Segment = {
  x: number;
  y: number;
  length: number;
  offset: number;
  cos: number;
  sin: number;
  alpha: number;
};

export const globeRows = Array.from({ length: 21 }, (_, index) => {
  const example = index % reviewExamples.length;
  const pair = reviewExamples[example];
  const period = Math.max(440, Math.max(pair.source.length, pair.reviewed.length) * 4.8);
  const latitude = ((index - 10) / 10) * 1.24;
  const width = Math.cos(latitude) * 169;
  const y = 205 + Math.sin(latitude) * 169 * 0.95;
  const bend = Math.cos(latitude) * 52;
  const segments: Segment[] = [];
  const steps = Math.ceil((width * 2) / 14);
  let offset = 0;
  for (let step = 0; step < steps; step++) {
    const t = step / steps;
    const next = (step + 1) / steps;
    const x = 205 - width + width * 2 * t;
    const cy = y - 2 * bend * t * (1 - t);
    const dx = (width * 2) / steps;
    const dy = y - 2 * bend * next * (1 - next) - cy;
    const length = Math.hypot(dx, dy);
    const radius = Math.hypot((x - 190) / 170, (cy - 185) / 170);
    segments.push({
      x,
      y: cy,
      length,
      offset,
      cos: dx / length,
      sin: dy / length,
      alpha: Math.max(0.12, 0.78 * (1 - 0.75 * radius ** 3)),
    });
    offset += length;
  }
  return {
    example,
    period,
    width,
    y,
    bend,
    segments,
    speed: period / (24 + (index % 4) * 3),
    reverse: index % 2 === 0,
  };
});

export function nearestRow(point: GlobePoint) {
  let closest = 10;
  let distance = Infinity;
  globeRows.forEach((row, index) => {
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

type Palette = { accent: string; gray: string; font: string };
export type GlobeFrame = {
  elapsed: number;
  point: GlobePoint;
  selected: number;
  phase: 'idle' | 'highlight' | 'edited';
  inspecting: boolean;
};

/** Shape text once. Animation only copies cached strips and transforms geometry. */
export function createGlobeRenderer(
  globe: HTMLCanvasElement,
  lens: HTMLCanvasElement,
  palette: Palette,
) {
  const mainContext = globe.getContext('2d');
  const lensContext = lens.getContext('2d');
  if (!mainContext || !lensContext) return null;
  const textures = reviewExamples.map((pair, index) => {
    const period = globeRows[index].period;
    return [pair.source, pair.reviewed].map((text) => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(period * textureScale);
      canvas.height = textureHeight * textureScale;
      const context = canvas.getContext('2d');
      if (!context) return canvas;
      context.scale(textureScale, textureScale);
      context.font = `8px ${palette.font}`;
      const width = context.measureText(text).width;
      context.scale(period / Math.max(1, width), 1);
      let x = 0;
      for (const token of text.split(/(\b(?:function|const|return|typeof|if|new|null)\b)/g)) {
        context.fillStyle = /^(function|const|return|typeof|if|new|null)$/.test(token)
          ? palette.accent
          : palette.gray;
        context.fillText(token, x, baseline);
        x += context.measureText(token).width;
      }
      return canvas;
    });
  });
  let density = 1;
  const resize = () => {
    density = Math.min(2, window.devicePixelRatio || 1);
    for (const [canvas, size] of [
      [globe, 440],
      [lens, 126],
    ] as const) {
      const pixels = Math.round(size * density * (canvas === lens ? 1.5 : 1));
      if (canvas.width !== pixels) {
        canvas.width = pixels;
        canvas.height = pixels;
      }
    }
  };
  resize();

  const paint = (
    context: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    state: GlobeFrame,
    zoom: number,
    origin: GlobePoint,
    size: number,
  ) => {
    context.resetTransform();
    context.clearRect(0, 0, canvas.width, canvas.height);
    const viewDensity = canvas.width / size;
    const scale = viewDensity * zoom;
    const tx = (size / 2 - origin.x * zoom) * viewDensity;
    const ty = (size / 2 - origin.y * zoom) * viewDensity;
    const left = origin.x - size / zoom / 2;
    const right = origin.x + size / zoom / 2;
    const top = origin.y - size / zoom / 2;
    const bottom = origin.y + size / zoom / 2;
    context.save();
    context.setTransform(scale, 0, 0, scale, tx, ty);
    context.beginPath();
    context.arc(205, 205, 170, 0, Math.PI * 2);
    context.clip();
    context.strokeStyle = palette.accent;
    context.lineWidth = 0.65;
    context.globalAlpha = 0.24;
    context.beginPath();
    context.arc(205, 205, 170, 0, Math.PI * 2);
    context.stroke();
    for (const radius of [85, 145]) {
      context.beginPath();
      context.ellipse(205, 205, radius, 170, -Math.PI / 15, 0, Math.PI * 2);
      context.stroke();
    }
    if (state.phase !== 'idle') {
      const row = globeRows[state.selected];
      context.lineWidth = 12;
      context.globalAlpha = state.phase === 'highlight' ? 0.18 : 0.13;
      context.beginPath();
      context.moveTo(205 - row.width, row.y);
      context.quadraticCurveTo(205, row.y - row.bend, 205 + row.width, row.y);
      context.stroke();
    }
    globeRows.forEach((row, index) => {
      const texture =
        textures[row.example][state.phase === 'edited' && state.selected === index ? 1 : 0];
      const motion = (state.elapsed / 1000) * row.speed * (row.reverse ? -1 : 1);
      for (const segment of row.segments) {
        if (
          segment.x > right + 14 ||
          segment.x + 16 < left ||
          segment.y < top - 4 ||
          segment.y > bottom + textureHeight
        )
          continue;
        const start = (((segment.offset + motion) % row.period) + row.period) % row.period;
        const first = Math.min(segment.length, row.period - start);
        context.globalAlpha = Math.min(1, segment.alpha * (zoom > 1 ? 1.35 : 1));
        context.setTransform(
          scale * segment.cos,
          scale * segment.sin,
          -scale * segment.sin,
          scale * segment.cos,
          tx + segment.x * scale,
          ty + segment.y * scale,
        );
        context.drawImage(
          texture,
          start * textureScale,
          0,
          first * textureScale,
          textureHeight * textureScale,
          0,
          -baseline,
          first,
          textureHeight,
        );
        if (first < segment.length)
          context.drawImage(
            texture,
            0,
            0,
            (segment.length - first) * textureScale,
            textureHeight * textureScale,
            first,
            -baseline,
            segment.length - first,
            textureHeight,
          );
      }
    });
    context.restore();
  };

  return {
    resize,
    draw(state: GlobeFrame) {
      paint(mainContext, globe, state, 1, { x: 220, y: 220 }, 440);
      paint(lensContext, lens, state, 1.75, state.point, 126);
    },
  };
}
