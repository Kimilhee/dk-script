/**
 * 리샘플 간격 스윕. 같은 모델·같은 필기를 고정하고 점 간격만 바꿔서
 * 정확도와 인코더 비용을 함께 잰다.
 *
 * 개발 머신에서 도는 단일 스레드 측정이다. P580 절대 지연의 대리 측정이며,
 * 유효한 건 설정 간 "비율"이다. 절대값을 production budget과 비교하지 마라.
 *
 *   node prototype/constraint-decoding/scripts/resample-sweep.ts [--limit N]
 *   node prototype/constraint-decoding/scripts/resample-sweep.ts --runtime wasm
 *
 * `--runtime wasm`은 브라우저와 같은 onnxruntime-web WASM 경로를 쓴다.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as ortNode from "onnxruntime-node";
import * as ortWeb from "onnxruntime-web/wasm";
import { supportsTokenSequence } from "../src/constraints.ts";
import { parseInkml, selectStratified } from "../src/inkml.ts";
import { buildVocab, canonicalizeLatex, tokenEditDistance, tokenizeLatex } from "../src/latex.ts";
import { MATHWRITING_SPACING, type ResampleOptions, resampleStrokes } from "../src/resample.ts";
import {
  OrtRecognizer,
  type RuntimeAdapter,
  type RuntimeSession,
  type RuntimeTensor,
} from "../src/ort-runner.ts";
import type { InkSample, Stroke } from "../src/types.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const prototype = path.join(root, "prototype/constraint-decoding");
const models = path.join(prototype, "public/models");
const limit = Number(option("--limit") ?? 500);

/** S Pen 디지타이저 근사. MathWriting은 약 50Hz, S Pen은 약 240Hz다. */
const PEN_UPSAMPLE = 5;

const categories = JSON.parse(await readFile(path.join(models, "vocab.json"), "utf8")) as Record<
  string,
  string[]
>;
const vocab = buildVocab(categories);
const useWasm = (option("--runtime") ?? "native") === "wasm";
const ort = useWasm ? ortWeb : ortNode;
if (useWasm) {
  ortWeb.env.wasm.numThreads = 1;
  ortWeb.env.wasm.proxy = false;
}
const runtime: RuntimeAdapter = {
  tensor(type, data, dims) {
    if (type === "float32" && data instanceof Float32Array)
      return new ort.Tensor("float32", data, [...dims]) as unknown as RuntimeTensor;
    if (type === "int64" && data instanceof BigInt64Array)
      return new ort.Tensor("int64", data, [...dims]) as unknown as RuntimeTensor;
    throw new Error(`Unsupported tensor ${type}`);
  },
};
const options = {
  executionProviders: [useWasm ? "wasm" : "cpu"],
  graphOptimizationLevel: "all",
  ...(useWasm ? {} : { intraOpNumThreads: 1 }),
} as ortNode.InferenceSession.SessionOptions;
console.log(
  `runtime=${useWasm ? "onnxruntime-web (wasm, 1 thread)" : "onnxruntime-node (native)"}`,
);
// ORT Web은 파일 경로를 못 받으므로 바이트로 넘긴다.
const load = async (file: string) => {
  const target = path.join(models, file);
  const source = useWasm ? new Uint8Array(await readFile(target)) : target;
  return ort.InferenceSession.create(source as string, options);
};
const [encoder, decoder] = await Promise.all([load("encoder.onnx"), load("decoder_step.onnx")]);
const recognizer = new OrtRecognizer(
  runtime,
  encoder as unknown as RuntimeSession,
  decoder as unknown as RuntimeSession,
  vocab,
);

const dataRoot = await findDataRoot();
const files = (await readdir(dataRoot)).filter((file) => file.endsWith(".inkml")).sort();
const parsed: InkSample[] = [];
for (const file of files) {
  const sample = parseInkml(
    await readFile(path.join(dataRoot, file), "utf8"),
    path.basename(file, ".inkml"),
  );
  if (supportsTokenSequence(vocab, sample.context, "problem", tokenizeLatex(sample.truth)))
    parsed.push(sample);
}
const samples = selectStratified(parsed, Math.min(limit, parsed.length));
console.log(`samples=${samples.length}  dataRoot=${path.relative(root, dataRoot)}`);

const configurations: Array<{ label: string; resample: ResampleOptions | false }> = [
  { label: "off (원시 샘플)", resample: false },
  { label: `${MATHWRITING_SPACING} (학습 분포 p50)`, resample: { spacing: MATHWRITING_SPACING } },
  { label: "0.0106 (학습 분포 p90)", resample: { spacing: 0.0106 } },
  { label: "0.013", resample: { spacing: 0.013 } },
  { label: "0.015", resample: { spacing: 0.015 } },
  { label: "0.022", resample: { spacing: 0.022 } },
  { label: "0.030 (최초 제안값)", resample: { spacing: 0.03 } },
];

for (const inputKind of [
  "native (약 50Hz)",
  `pen240 (약 240Hz, ${PEN_UPSAMPLE}x 업샘플)`,
] as const) {
  const upsample = inputKind.startsWith("pen240");
  const prepared = samples.map((sample) => ({
    ...sample,
    strokes: upsample ? sample.strokes.map(densify) : sample.strokes,
  }));
  const rawPoints = mean(prepared.map((s) => s.strokes.reduce((n, k) => n + k.length, 0)));
  console.log(`\n### 입력: ${inputKind} — 원시 평균 ${rawPoints.toFixed(0)}점`);
  console.log(
    "| spacing | 인코더 입력 점 | encode p50 | 전체 p50 | 전체 p95 | exact | token err | vs off |",
  );
  console.log("|---|---:|---:|---:|---:|---:|---:|---:|");

  let baseline = 0;
  for (const configuration of configurations) {
    const points: number[] = [];
    const encodeMs: number[] = [];
    const totalMs: number[] = [];
    let exact = 0;
    let editSum = 0;
    let tokenSum = 0;

    for (const sample of prepared) {
      const startedEncode = performance.now();
      const memory = await recognizer.encode(sample.strokes, configuration.resample);
      const encodeElapsed = performance.now() - startedEncode;
      const result = await recognizer.recognize(sample.strokes, sample.context, "problem", memory, {
        beamSize: 2,
        maxLength: 48,
      });
      const total = encodeElapsed + result.elapsedMs;
      const fed =
        configuration.resample === false
          ? sample.strokes
          : resampleStrokes(sample.strokes, configuration.resample);
      points.push(fed.reduce((n, stroke) => n + stroke.length, 0));
      encodeMs.push(encodeElapsed);
      totalMs.push(total);

      const truth = canonicalizeLatex(sample.truth);
      const prediction = canonicalizeLatex(result.latex);
      if (truth === prediction) exact += 1;
      editSum += tokenEditDistance(truth, prediction);
      tokenSum += Math.max(1, tokenizeLatex(truth).length);
    }

    const p50 = quantile(totalMs, 0.5);
    if (configuration.resample === false) baseline = p50;
    const speedup = baseline > 0 ? `${(baseline / p50).toFixed(1)}×` : "—";
    console.log(
      `| ${configuration.label} | ${mean(points).toFixed(0)} | ` +
        `${quantile(encodeMs, 0.5).toFixed(0)}ms | ${p50.toFixed(0)}ms | ` +
        `${quantile(totalMs, 0.95).toFixed(0)}ms | ` +
        `${((exact / prepared.length) * 100).toFixed(1)}% | ` +
        `${((editSum / tokenSum) * 100).toFixed(1)}% | ${speedup} |`,
    );
  }
}

/** 획 사이를 선형 보간해 샘플레이트만 올린다. 형태는 그대로다. */
function densify(stroke: Stroke): Stroke {
  if (stroke.length < 2) return stroke;
  const output = [stroke[0]];
  for (let index = 1; index < stroke.length; index += 1) {
    const from = stroke[index - 1];
    const to = stroke[index];
    for (let step = 1; step <= PEN_UPSAMPLE; step += 1) {
      const ratio = step / PEN_UPSAMPLE;
      output.push({
        x: from.x + (to.x - from.x) * ratio,
        y: from.y + (to.y - from.y) * ratio,
        t: from.t + (to.t - from.t) * ratio,
      });
    }
  }
  return output;
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function quantile(values: number[], probability: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * probability))] ?? 0;
}

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function findDataRoot(): Promise<string> {
  const candidates = [
    path.join(prototype, "data/mathwriting-2024/test"),
    path.join(prototype, "data/mathwriting-2024-excerpt/test"),
  ];
  for (const candidate of candidates) {
    try {
      if ((await stat(candidate)).isDirectory()) return candidate;
    } catch {
      continue;
    }
  }
  throw new Error("MathWriting data is missing. Run vp run poc:prepare first");
}
