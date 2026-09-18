import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as ort from "onnxruntime-node";
import { supportsTokenSequence } from "../src/constraints.ts";
import { parseInkml, selectStratified } from "../src/inkml.ts";
import {
  buildVocab,
  canonicalizeLatex,
  isStructurallyValidLatex,
  tokenEditDistance,
  tokenizeLatex,
} from "../src/latex.ts";
import {
  OrtRecognizer,
  type RuntimeAdapter,
  type RuntimeSession,
  type RuntimeTensor,
} from "../src/ort-runner.ts";
import type { DecodeMode, InkSample, RecognitionResult } from "../src/types.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const prototype = path.join(root, "prototype/constraint-decoding");
const models = path.join(prototype, "public/models");
const reports = path.join(prototype, "reports");
const requestedLimit = Number(option("--limit") ?? 500);
const dataRoot = await findDataRoot();

const categories = JSON.parse(await readFile(path.join(models, "vocab.json"), "utf8")) as Record<
  string,
  string[]
>;
const vocab = buildVocab(categories);
const runtime: RuntimeAdapter = {
  tensor(type, data, dims) {
    if (type === "float32" && data instanceof Float32Array) {
      return new ort.Tensor("float32", data, [...dims]) as unknown as RuntimeTensor;
    }
    if (type === "int64" && data instanceof BigInt64Array) {
      return new ort.Tensor("int64", data, [...dims]) as unknown as RuntimeTensor;
    }
    throw new Error(`Unsupported tensor ${type}`);
  },
};

const [encoder, decoder] = await Promise.all([
  ort.InferenceSession.create(path.join(models, "encoder.onnx"), sessionOptions()),
  ort.InferenceSession.create(path.join(models, "decoder_step.onnx"), sessionOptions()),
]);
const recognizer = new OrtRecognizer(
  runtime,
  encoder as unknown as RuntimeSession,
  decoder as unknown as RuntimeSession,
  vocab,
);

const files = (await readdir(dataRoot)).filter((file) => file.endsWith(".inkml")).sort();
const parsed: InkSample[] = [];
for (const file of files) {
  const sample = parseInkml(
    await readFile(path.join(dataRoot, file), "utf8"),
    path.basename(file, ".inkml"),
  );
  const truthTokens = tokenizeLatex(sample.truth);
  if (supportsTokenSequence(vocab, sample.context, "problem", truthTokens)) parsed.push(sample);
}
const samples = selectStratified(parsed, Math.min(requestedLimit, parsed.length));
if (samples.length < requestedLimit) {
  console.warn(
    `Only ${samples.length}/${requestedLimit} mappable samples are available in ${dataRoot}`,
  );
}

const modes: DecodeMode[] = ["open", "level", "schema", "problem"];
const rows: ResultRow[] = [];
for (let sampleIndex = 0; sampleIndex < samples.length; sampleIndex += 1) {
  const sample = samples[sampleIndex];
  const memory = await recognizer.encode(sample.strokes);
  for (const mode of modes) {
    try {
      const result = await recognizer.recognize(sample.strokes, sample.context, mode, memory);
      rows.push(toRow(sample, mode, result));
    } catch (error) {
      rows.push(toErrorRow(sample, mode, error));
    }
  }
  process.stdout.write(`\r${sampleIndex + 1}/${samples.length} samples`);
}
process.stdout.write("\n");

const summary = summarize(rows, modes);
const generatedAt = new Date().toISOString();
const report = {
  generatedAt,
  researchOnly: true,
  baseline: "m4jkiuwr/htt-mini",
  sampleCount: samples.length,
  dataRoot,
  sampleIds: samples.map((sample) => sample.id),
  modelDigests: {
    encoder: await sha256(path.join(models, "encoder.onnx")),
    decoder: await sha256(path.join(models, "decoder_step.onnx")),
  },
  summary,
  rows,
};
await writeFile(
  path.join(reports, "constraint-decoding.json"),
  `${JSON.stringify(report, null, 2)}\n`,
);
await writeFile(path.join(reports, "constraint-decoding.md"), renderMarkdown(report));
console.log(renderTable(summary));
console.log(`\nReports written to ${reports}`);

function sessionOptions(): ort.InferenceSession.SessionOptions {
  return { executionProviders: ["cpu"], graphOptimizationLevel: "all", intraOpNumThreads: 1 };
}

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function findDataRoot(): Promise<string> {
  const explicit = option("--data");
  const candidates = explicit
    ? [path.resolve(explicit)]
    : [
        path.join(prototype, "data/mathwriting-2024/test"),
        path.join(prototype, "data/mathwriting-2024-excerpt/test"),
      ];
  for (const candidate of candidates) {
    try {
      if ((await stat(candidate)).isDirectory()) return candidate;
    } catch {
      // Try the next known data location.
    }
  }
  throw new Error(
    "No MathWriting test data. Run: vp run poc:prepare -- --accept-research-license --full",
  );
}

interface ResultRow {
  id: string;
  mode: DecodeMode;
  schoolLevel: string;
  answerType: string;
  truth: string;
  prediction: string;
  alternatives: string[];
  exact: boolean;
  top3: boolean;
  editDistance: number;
  truthTokens: number;
  invalid: boolean;
  elapsedMs: number;
  error?: string;
}

function toRow(sample: InkSample, mode: DecodeMode, result: RecognitionResult): ResultRow {
  const truth = canonicalizeLatex(sample.truth);
  const prediction = canonicalizeLatex(result.latex);
  const alternatives = [
    result.latex,
    ...result.alternatives.map((candidate) => candidate.latex),
  ].map(canonicalizeLatex);
  return {
    id: sample.id,
    mode,
    schoolLevel: sample.context.schoolLevel,
    answerType: sample.context.answerType,
    truth,
    prediction,
    alternatives,
    exact: truth === prediction,
    top3: alternatives.includes(truth),
    editDistance: tokenEditDistance(truth, prediction),
    truthTokens: Math.max(1, tokenizeLatex(truth).length),
    invalid: !isStructurallyValidLatex(prediction),
    elapsedMs: result.elapsedMs,
  };
}

function toErrorRow(sample: InkSample, mode: DecodeMode, error: unknown): ResultRow {
  return {
    id: sample.id,
    mode,
    schoolLevel: sample.context.schoolLevel,
    answerType: sample.context.answerType,
    truth: canonicalizeLatex(sample.truth),
    prediction: "",
    alternatives: [],
    exact: false,
    top3: false,
    editDistance: tokenizeLatex(sample.truth).length,
    truthTokens: Math.max(1, tokenizeLatex(sample.truth).length),
    invalid: true,
    elapsedMs: 0,
    error: error instanceof Error ? error.message : String(error),
  };
}

interface ModeSummary {
  mode: DecodeMode;
  samples: number;
  exact: number;
  top3: number;
  tokenErrorRate: number;
  invalid: number;
  p50Ms: number;
  p95Ms: number;
  relativeErrorReduction: number;
}

function summarize(allRows: ResultRow[], orderedModes: DecodeMode[]): ModeSummary[] {
  const openRows = allRows.filter((row) => row.mode === "open");
  const openError = 1 - ratio(openRows.filter((row) => row.exact).length, openRows.length);
  return orderedModes.map((mode) => {
    const modeRows = allRows.filter((row) => row.mode === mode);
    const exact = ratio(modeRows.filter((row) => row.exact).length, modeRows.length);
    const error = 1 - exact;
    const times = modeRows
      .map((row) => row.elapsedMs)
      .filter((time) => time > 0)
      .sort((a, b) => a - b);
    return {
      mode,
      samples: modeRows.length,
      exact,
      top3: ratio(modeRows.filter((row) => row.top3).length, modeRows.length),
      tokenErrorRate:
        modeRows.reduce((sum, row) => sum + row.editDistance, 0) /
        Math.max(
          1,
          modeRows.reduce((sum, row) => sum + row.truthTokens, 0),
        ),
      invalid: ratio(modeRows.filter((row) => row.invalid).length, modeRows.length),
      p50Ms: percentile(times, 0.5),
      p95Ms: percentile(times, 0.95),
      relativeErrorReduction: openError === 0 ? 0 : (openError - error) / openError,
    };
  });
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function percentile(values: number[], quantile: number): number {
  if (values.length === 0) return 0;
  return values[Math.min(values.length - 1, Math.floor(values.length * quantile))];
}

function renderTable(summary: ModeSummary[]): string {
  const header = "mode     exact   top3    TER     invalid  err-reduction  p50/p95 ms";
  const lines = summary.map(
    (row) =>
      `${row.mode.padEnd(8)} ${percent(row.exact).padEnd(7)} ${percent(row.top3).padEnd(7)} ${percent(row.tokenErrorRate).padEnd(7)} ${percent(row.invalid).padEnd(8)} ${percent(row.relativeErrorReduction).padEnd(14)} ${row.p50Ms.toFixed(0)}/${row.p95Ms.toFixed(0)}`,
  );
  return [header, ...lines].join("\n");
}

function renderMarkdown(report: {
  generatedAt: string;
  sampleCount: number;
  summary: ModeSummary[];
}): string {
  const table = [
    "| Mode | Exact | Top-3 | Token error | Invalid | Error reduction vs open | p50/p95 |",
    "|---|---:|---:|---:|---:|---:|---:|",
    ...report.summary.map(
      (row) =>
        `| ${row.mode} | ${percent(row.exact)} | ${percent(row.top3)} | ${percent(row.tokenErrorRate)} | ${percent(row.invalid)} | ${percent(row.relativeErrorReduction)} | ${row.p50Ms.toFixed(0)}/${row.p95Ms.toFixed(0)} ms |`,
    ),
  ];
  return `# Constraint decoding PoC\n\nGenerated: ${report.generatedAt}\n\n> Research-only exploratory result. Do not use as a production accuracy claim.\n\nSamples: ${report.sampleCount}\n\n${table.join("\n")}\n\n## Verdict\n\nPending review on P580 and P610.\n`;
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

async function sha256(file: string): Promise<string> {
  const hash = createHash("sha256");
  hash.update(await readFile(file));
  return hash.digest("hex");
}
