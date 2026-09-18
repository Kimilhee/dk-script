import { inferContext } from "./latex.ts";
import type { InkSample, Stroke } from "./types.ts";

export function parseInkml(xml: string, fallbackId: string): InkSample {
  const truth = decodeEntities(
    findAnnotation(xml, "normalizedLabel") ?? findAnnotation(xml, "label") ?? "",
  );
  if (!truth) throw new Error(`${fallbackId}: normalizedLabel is missing`);
  const id = findAnnotation(xml, "sampleId") ?? fallbackId;
  const strokes: Stroke[] = [...xml.matchAll(/<trace\b[^>]*>([\s\S]*?)<\/trace>/gu)].map((match) =>
    match[1]
      .trim()
      .split(",")
      .map((point) => {
        const [x, y, t] = point.trim().split(/\s+/u).map(Number);
        return { x, y, t };
      })
      .filter((point) => [point.x, point.y, point.t].every(Number.isFinite)),
  );
  if (strokes.length === 0) throw new Error(`${id}: no traces found`);
  return { id, truth, strokes, context: inferContext(truth) };
}

function findAnnotation(xml: string, type: string): string | undefined {
  const pattern = new RegExp(
    `<annotation\\s+type=["']${type}["'][^>]*>([\\s\\S]*?)<\\/annotation>`,
    "u",
  );
  return pattern.exec(xml)?.[1]?.trim();
}

function decodeEntities(value: string): string {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'");
}

export function selectStratified(samples: InkSample[], limit: number): InkSample[] {
  const groups = new Map<string, InkSample[]>();
  for (const sample of samples) {
    const key = `${sample.context.schoolLevel}/${sample.context.answerType}`;
    const group = groups.get(key) ?? [];
    group.push(sample);
    groups.set(key, group);
  }
  for (const group of groups.values())
    group.sort((left, right) => stableHash(left.id) - stableHash(right.id));

  const selected: InkSample[] = [];
  const orderedGroups = [...groups.values()].sort((left, right) =>
    left[0].id.localeCompare(right[0].id),
  );
  while (selected.length < limit && orderedGroups.some((group) => group.length > 0)) {
    for (const group of orderedGroups) {
      const sample = group.shift();
      if (sample) selected.push(sample);
      if (selected.length === limit) break;
    }
  }
  return selected;
}

function stableHash(value: string): number {
  let hash = 2_166_136_261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}
