import type { Stroke } from "./types.ts";

export interface InferenceFeatures {
  data: Float32Array;
  points: number;
  dimensions: 12;
}

const EPSILON = 1e-6;

export function extractFeatures(strokes: Stroke[]): InferenceFeatures {
  const nonEmpty = strokes.filter((stroke) => stroke.length > 0);
  const all = nonEmpty.flat();
  if (all.length === 0) return { data: new Float32Array(), points: 0, dimensions: 12 };

  const minX = Math.min(...all.map((point) => point.x));
  const maxX = Math.max(...all.map((point) => point.x));
  const minY = Math.min(...all.map((point) => point.y));
  const maxY = Math.max(...all.map((point) => point.y));
  const minT = Math.min(...all.map((point) => point.t));
  const maxT = Math.max(...all.map((point) => point.t));
  const xyRange = Math.max(maxX - minX, maxY - minY) + EPSILON;
  const timeRange = maxT - minT + EPSILON;
  const expressionYSpan = maxY - minY + EPSILON;
  const rows: number[][] = [];

  for (const stroke of nonEmpty) {
    const strokeMinY = Math.min(...stroke.map((point) => point.y));
    const strokeMaxY = Math.max(...stroke.map((point) => point.y));
    const yCenter = ((strokeMinY + strokeMaxY) / 2 - minY) / expressionYSpan;
    const ySpan = (strokeMaxY - strokeMinY) / expressionYSpan;
    const speeds: number[] = [];
    const directions: Array<[number, number]> = [];

    for (let index = 0; index < stroke.length; index += 1) {
      const point = stroke[index];
      const x = (point.x - minX) / xyRange;
      const y = (point.y - minY) / xyRange;
      const t = (point.t - minT) / timeRange;
      let dx = 0;
      let dy = 0;
      let dt = 0;
      let distance = 0;
      let speed = 0;
      let ux = 0;
      let uy = 0;
      if (index > 0) {
        const previous = stroke[index - 1];
        dx = x - (previous.x - minX) / xyRange;
        dy = y - (previous.y - minY) / xyRange;
        dt = t - (previous.t - minT) / timeRange;
        distance = Math.hypot(dx, dy);
        speed = dt > EPSILON ? distance / dt : 0;
        ux = distance > EPSILON ? dx / distance : 0;
        uy = distance > EPSILON ? dy / distance : 0;
      }
      let curvature = 0;
      let tangentAcceleration = 0;
      if (index > 0) {
        tangentAcceleration = dt > EPSILON ? (speed - speeds[index - 1]) / dt : 0;
      }
      if (index > 1 && distance > EPSILON) {
        const [previousUx, previousUy] = directions[index - 1];
        curvature =
          Math.atan2(previousUx * uy - previousUy * ux, previousUx * ux + previousUy * uy) /
          distance;
      }
      speeds.push(speed);
      directions.push([ux, uy]);
      rows.push([
        x,
        y,
        t,
        dx,
        dy,
        dt,
        speed,
        curvature,
        tangentAcceleration,
        index === 0 ? 1 : 0,
        yCenter,
        ySpan,
      ]);
    }
  }

  for (const column of [3, 4, 5, 6, 7, 8]) {
    const mean = rows.reduce((sum, row) => sum + row[column], 0) / rows.length;
    const variance = rows.reduce((sum, row) => sum + (row[column] - mean) ** 2, 0) / rows.length;
    const deviation = Math.sqrt(variance) + EPSILON;
    for (const row of rows)
      row[column] = Math.max(-5, Math.min(5, (row[column] - mean) / deviation));
  }

  return { data: new Float32Array(rows.flat()), points: rows.length, dimensions: 12 };
}
