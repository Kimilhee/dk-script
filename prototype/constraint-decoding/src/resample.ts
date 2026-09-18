import type { Stroke, StrokePoint } from "./types.ts";

/**
 * MathWriting-2024 test split 100개 실측 점 간격(bbox 최대변 대비) p50.
 * p10=0.0049 / p50=0.0065 / p90=0.0106.
 */
export const MATHWRITING_SPACING = 0.0065;

/**
 * 기본 간격. 학습 분포 p50이다.
 *
 * `scripts/resample-sweep.ts --runtime wasm` 26샘플 측정(브라우저와 같은 WASM 경로):
 *
 * | spacing | 점 | pen240 p50 | exact | token err |
 * |---|---:|---:|---:|---:|
 * | off    | 1607 | 188ms | 19.2% | 17.6% |
 * | 0.0065 |  383 |  60ms | 73.1% |  3.8% |
 * | 0.0106 |  247 |  50ms | 73.1% |  5.5% |
 * | 0.022  |  130 |  41ms | 42.3% | 10.8% |
 *
 * 0.0065는 50Hz 원시 입력 baseline(73.1% / 3.8%)과 exact도 token error도 같다.
 * 0.0106은 20% 더 빠르지만 token error가 조금 오른다. 속도가 더 급하면 그쪽을 쓰고,
 * 그 위(0.015+)는 정확도가 실제로 꺾이므로 쓰지 마라.
 *
 * 26샘플은 탐색 표본이다. 인증셋에서 재확인하기 전에는 고정된 최적값으로 취급하지 마라.
 */
export const DEFAULT_SPACING = MATHWRITING_SPACING;

export interface ResampleOptions {
  /** bbox 최대변 대비 목표 점 간격. 크면 점이 줄고 빨라진다. */
  spacing?: number;
  /** 총 점 개수 상한. 초과하면 간격을 넓혀 다시 뽑는다. */
  maxPoints?: number;
}

/**
 * 획을 호길이(arc length) 등간격으로 다시 찍는다.
 *
 * 입력 장치의 샘플레이트를 제거하는 게 목적이다. 같은 필기를 50Hz로 받아도
 * 240Hz로 받아도 같은 점 개수가 나오므로, 인코더의 O(n^2) self-attention 비용이
 * 필기 속도나 디지타이저 성능에 흔들리지 않는다.
 *
 * 간격은 bbox 최대변에 비례하므로 스케일 불변이다.
 */
export function resampleStrokes(strokes: Stroke[], options: ResampleOptions = {}): Stroke[] {
  const ratio = options.spacing ?? DEFAULT_SPACING;
  const maxPoints = options.maxPoints ?? 512;
  const nonEmpty = strokes.filter((stroke) => stroke.length > 0);
  if (nonEmpty.length === 0) return strokes;

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const stroke of nonEmpty)
    for (const point of stroke) {
      if (point.x < minX) minX = point.x;
      if (point.x > maxX) maxX = point.x;
      if (point.y < minY) minY = point.y;
      if (point.y > maxY) maxY = point.y;
    }

  const scale = Math.max(maxX - minX, maxY - minY);
  // 모든 점이 한 자리에 모인 탭 입력. 나눌 기준이 없으므로 그대로 둔다.
  if (!(scale > 0) || !(ratio > 0)) return nonEmpty;

  let spacing = ratio * scale;
  let resampled = nonEmpty.map((stroke) => resampleStroke(stroke, spacing));
  // 획 개수 자체가 상한을 넘으면 더 줄일 수 없으므로 시도 횟수를 묶어둔다.
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const total = resampled.reduce((sum, stroke) => sum + stroke.length, 0);
    if (total <= maxPoints) break;
    spacing *= Math.max(1.2, total / maxPoints);
    resampled = nonEmpty.map((stroke) => resampleStroke(stroke, spacing));
  }
  return resampled;
}

function resampleStroke(stroke: Stroke, spacing: number): Stroke {
  // 점 하나짜리 획은 소수점이나 i의 점이다. 반드시 살린다.
  if (stroke.length < 2) return [...stroke];

  const output: StrokePoint[] = [stroke[0]];
  let previous = stroke[0];
  let carried = 0;

  for (let index = 1; index < stroke.length; index += 1) {
    const target = stroke[index];
    let remaining = Math.hypot(target.x - previous.x, target.y - previous.y);
    // carried < spacing 이 항상 성립하므로 remaining > 0 일 때만 진입한다.
    while (carried + remaining >= spacing) {
      const step = (spacing - carried) / remaining;
      previous = {
        x: previous.x + (target.x - previous.x) * step,
        y: previous.y + (target.y - previous.y) * step,
        t: previous.t + (target.t - previous.t) * step,
      };
      output.push(previous);
      remaining = Math.hypot(target.x - previous.x, target.y - previous.y);
      carried = 0;
    }
    carried += remaining;
    previous = target;
  }

  // 획 끝점은 형태 정보이므로 간격에 안 맞아도 유지한다.
  const last = stroke[stroke.length - 1];
  const tail = output[output.length - 1];
  if (tail.x !== last.x || tail.y !== last.y) output.push(last);
  return output;
}
