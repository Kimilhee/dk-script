import * as ort from "onnxruntime-web/wasm";
import { buildVocab } from "./latex.ts";
import {
  OrtRecognizer,
  type RuntimeAdapter,
  type RuntimeSession,
  type RuntimeTensor,
} from "./ort-runner.ts";
import type { RecognitionContext, Stroke } from "./types.ts";

ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;

let recognizer: OrtRecognizer | undefined;
let latestRequestId = 0;

const localAssets = {
  vocab: `${import.meta.env.BASE_URL}models/vocab.json`,
  encoder: `${import.meta.env.BASE_URL}models/encoder.onnx`,
  decoder: `${import.meta.env.BASE_URL}models/decoder_step.onnx`,
};

const remoteAssets = {
  vocab:
    "https://raw.githubusercontent.com/Projekt-Deep-Learning-2026/hand-to-tex/main/web/public/assets/vocab.json",
  encoder: "https://huggingface.co/m4jkiuwr/htt-mini/resolve/main/encoder.onnx?download=true",
  decoder: "https://huggingface.co/m4jkiuwr/htt-mini/resolve/main/decoder_step.onnx?download=true",
};

self.addEventListener("message", (event: MessageEvent<WorkerRequest>) => {
  void handle(event.data);
});

async function handle(request: WorkerRequest): Promise<void> {
  try {
    if (request.type === "load") {
      const started = performance.now();
      recognizer = await loadRecognizer();
      respond({ type: "ready", elapsedMs: performance.now() - started });
      return;
    }
    latestRequestId = request.id;
    const loadedRecognizer = recognizer;
    if (!loadedRecognizer) throw new Error("Model is not loaded");
    const memory = await loadedRecognizer.encode(request.strokes);
    if (request.id !== latestRequestId) return;
    const result = await loadedRecognizer.recognize(
      request.strokes,
      request.context,
      "problem",
      memory,
      { beamSize: 2, maxLength: 48 },
    );
    if (request.id !== latestRequestId) return;
    respond({ type: "result", id: request.id, result });
    respond({ type: "complete", id: request.id });
  } catch (error) {
    respond({
      type: "error",
      id: request.type === "recognize" ? request.id : undefined,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function loadRecognizer(): Promise<OrtRecognizer> {
  const assets =
    import.meta.env.VITE_REMOTE_RESEARCH_ASSETS === "true" ? remoteAssets : localAssets;
  const response = await fetch(assets.vocab);
  if (!response.ok)
    throw new Error(
      "Research assets are missing. Run vp run poc:prepare -- --accept-research-license",
    );
  const categories = (await response.json()) as Record<string, string[]>;
  const options: ort.InferenceSession.SessionOptions = {
    executionProviders: ["wasm"],
    graphOptimizationLevel: "all",
  };
  const [encoder, decoder] = await Promise.all([
    ort.InferenceSession.create(assets.encoder, options),
    ort.InferenceSession.create(assets.decoder, options),
  ]);
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
  return new OrtRecognizer(
    runtime,
    encoder as unknown as RuntimeSession,
    decoder as unknown as RuntimeSession,
    buildVocab(categories),
  );
}

function respond(message: WorkerResponse): void {
  self.postMessage(message);
}

type WorkerRequest =
  | { type: "load" }
  | {
      type: "recognize";
      id: number;
      strokes: Stroke[];
      context: RecognitionContext;
    };

type WorkerResponse =
  | { type: "ready"; elapsedMs: number }
  | {
      type: "result";
      id: number;
      result: Awaited<ReturnType<OrtRecognizer["recognize"]>>;
    }
  | { type: "complete"; id: number }
  | { type: "error"; id?: number; message: string };
