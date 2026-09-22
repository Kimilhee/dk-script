import type { Stroke, StrokePoint } from "./types.ts";

export interface CanvasPoint {
  x: number;
  y: number;
}

export function eraseStrokes(
  strokes: Stroke[],
  from: CanvasPoint,
  to: CanvasPoint,
  diameter: number,
): { strokes: Stroke[]; changed: boolean } {
  const radius = diameter / 2;
  const output: Stroke[] = [];
  let changed = false;

  for (const stroke of strokes) {
    if (!intersectsEraser(stroke, from, to, radius)) {
      output.push(stroke);
      continue;
    }
    changed = true;
    output.push(...splitOutsideEraser(stroke, from, to, radius));
  }
  return { strokes: output, changed };
}

function intersectsEraser(
  stroke: Stroke,
  from: CanvasPoint,
  to: CanvasPoint,
  radius: number,
): boolean {
  if (stroke.length === 1) return distanceToSegment(stroke[0], from, to) <= radius;
  for (let index = 1; index < stroke.length; index += 1) {
    if (segmentDistance(stroke[index - 1], stroke[index], from, to) <= radius) return true;
  }
  return false;
}

function splitOutsideEraser(
  stroke: Stroke,
  from: CanvasPoint,
  to: CanvasPoint,
  radius: number,
): Stroke[] {
  if (stroke.length === 1) return [];
  const sampled: Stroke = [stroke[0]];
  for (let index = 1; index < stroke.length; index += 1) {
    const start = stroke[index - 1];
    const end = stroke[index];
    const steps = Math.max(1, Math.ceil(Math.hypot(end.x - start.x, end.y - start.y) / 1.5));
    for (let step = 1; step <= steps; step += 1)
      sampled.push(interpolate(start, end, step / steps));
  }

  const fragments: Stroke[] = [];
  let fragment: Stroke = [];
  for (const point of sampled) {
    if (distanceToSegment(point, from, to) > radius) {
      fragment.push(point);
      continue;
    }
    if (fragment.length > 1) fragments.push(fragment);
    fragment = [];
  }
  if (fragment.length > 1) fragments.push(fragment);
  return fragments;
}

function interpolate(start: StrokePoint, end: StrokePoint, ratio: number): StrokePoint {
  const pressure =
    start.pressure === undefined && end.pressure === undefined
      ? undefined
      : (start.pressure ?? 0.5) + ((end.pressure ?? 0.5) - (start.pressure ?? 0.5)) * ratio;
  return {
    x: start.x + (end.x - start.x) * ratio,
    y: start.y + (end.y - start.y) * ratio,
    t: start.t + (end.t - start.t) * ratio,
    pressure,
  };
}

function segmentDistance(
  startA: CanvasPoint,
  endA: CanvasPoint,
  startB: CanvasPoint,
  endB: CanvasPoint,
): number {
  if (segmentsIntersect(startA, endA, startB, endB)) return 0;
  return Math.min(
    distanceToSegment(startA, startB, endB),
    distanceToSegment(endA, startB, endB),
    distanceToSegment(startB, startA, endA),
    distanceToSegment(endB, startA, endA),
  );
}

function distanceToSegment(point: CanvasPoint, start: CanvasPoint, end: CanvasPoint): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const ratio = Math.max(
    0,
    Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared),
  );
  return Math.hypot(point.x - (start.x + dx * ratio), point.y - (start.y + dy * ratio));
}

function segmentsIntersect(
  startA: CanvasPoint,
  endA: CanvasPoint,
  startB: CanvasPoint,
  endB: CanvasPoint,
): boolean {
  const epsilon = 1e-9;
  const cross = (a: CanvasPoint, b: CanvasPoint, c: CanvasPoint) =>
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const onSegment = (start: CanvasPoint, end: CanvasPoint, point: CanvasPoint) =>
    point.x >= Math.min(start.x, end.x) - epsilon &&
    point.x <= Math.max(start.x, end.x) + epsilon &&
    point.y >= Math.min(start.y, end.y) - epsilon &&
    point.y <= Math.max(start.y, end.y) + epsilon;
  const a = cross(startA, endA, startB);
  const b = cross(startA, endA, endB);
  const c = cross(startB, endB, startA);
  const d = cross(startB, endB, endA);
  if (Math.abs(a) <= epsilon && onSegment(startA, endA, startB)) return true;
  if (Math.abs(b) <= epsilon && onSegment(startA, endA, endB)) return true;
  if (Math.abs(c) <= epsilon && onSegment(startB, endB, startA)) return true;
  if (Math.abs(d) <= epsilon && onSegment(startB, endB, endA)) return true;
  return a > 0 !== b > 0 && c > 0 !== d > 0;
}
