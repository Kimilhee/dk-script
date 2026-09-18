import { constrainedBeamSearch } from "./beam.ts";
import { extractFeatures } from "./features.ts";
import type { DecodeMode, RecognitionContext, RecognitionResult, Stroke, Vocab } from "./types.ts";

type TensorData = Float32Array | BigInt64Array | Uint8Array;

export interface RuntimeTensor {
  readonly data: TensorData;
  readonly dims: readonly number[];
}

export interface RuntimeSession {
  run(feeds: Record<string, RuntimeTensor>): Promise<Record<string, RuntimeTensor>>;
}

export interface RuntimeAdapter {
  tensor(type: "float32" | "int64", data: TensorData, dims: readonly number[]): RuntimeTensor;
}

interface Memory {
  key: RuntimeTensor;
  value: RuntimeTensor;
  mask: RuntimeTensor;
}

interface Cache {
  key: RuntimeTensor;
  value: RuntimeTensor;
}

export interface DecodeOptions {
  beamSize?: number;
  maxLength?: number;
}

export class OrtRecognizer {
  private readonly runtime: RuntimeAdapter;
  private readonly encoder: RuntimeSession;
  private readonly decoder: RuntimeSession;
  readonly vocab: Vocab;

  constructor(
    runtime: RuntimeAdapter,
    encoder: RuntimeSession,
    decoder: RuntimeSession,
    vocab: Vocab,
  ) {
    this.runtime = runtime;
    this.encoder = encoder;
    this.decoder = decoder;
    this.vocab = vocab;
  }

  async encode(strokes: Stroke[]): Promise<Memory> {
    const features = extractFeatures(strokes);
    if (features.points === 0) throw new Error("Draw at least one stroke before recognition");
    const results = await this.encoder.run({
      src: this.runtime.tensor("float32", features.data, [1, features.points, features.dimensions]),
      src_lengths: this.runtime.tensor("int64", new BigInt64Array([BigInt(features.points)]), [1]),
    });
    return {
      key: requireOutput(results, "mem_k"),
      value: requireOutput(results, "mem_v"),
      mask: requireOutput(results, "mem_mask"),
    };
  }

  async recognize(
    strokes: Stroke[],
    context: RecognitionContext,
    mode: DecodeMode,
    existingMemory?: Memory,
    options: DecodeOptions = {},
  ): Promise<RecognitionResult> {
    const started = performance.now();
    const memory = existingMemory ?? (await this.encode(strokes));
    const candidates = await constrainedBeamSearch({
      initialState: this.emptyCache(memory),
      vocab: this.vocab,
      context,
      mode,
      beamSize: options.beamSize ?? 3,
      maxLength: options.maxLength ?? 64,
      step: async (cache, lastToken, step) => {
        const results = await this.decoder.run({
          tgt_last: this.runtime.tensor("int64", new BigInt64Array([BigInt(lastToken)]), [1, 1]),
          mem_k: memory.key,
          mem_v: memory.value,
          memory_key_padding_mask: memory.mask,
          step: this.runtime.tensor("int64", new BigInt64Array([BigInt(step)]), [1]),
          self_k: cache.key,
          self_v: cache.value,
        });
        return {
          logits: requireFloatOutput(results, "logits"),
          state: {
            key: requireOutput(results, "self_k_out"),
            value: requireOutput(results, "self_v_out"),
          },
        };
      },
    });
    const alternatives = candidates.map((candidate) => ({
      latex: candidate.tokenIds.map((id) => this.vocab.id2token[id]).join(""),
      confidence: candidate.confidence,
    }));
    const best = alternatives[0] ?? { latex: "", confidence: 0 };
    return {
      latex: best.latex,
      confidence: best.confidence,
      alternatives: alternatives.slice(1),
      symbols:
        candidates[0]?.tokenIds.map((id) => ({ token: this.vocab.id2token[id], strokeIds: [] })) ??
        [],
      elapsedMs: performance.now() - started,
    };
  }

  private emptyCache(memory: Memory): Cache {
    const layers = memory.key.dims[0];
    const batch = memory.key.dims[1];
    const heads = memory.key.dims[2];
    const headDimensions = memory.key.dims[4];
    return {
      key: this.runtime.tensor("float32", new Float32Array(), [
        layers,
        batch,
        heads,
        0,
        headDimensions,
      ]),
      value: this.runtime.tensor("float32", new Float32Array(), [
        layers,
        batch,
        heads,
        0,
        headDimensions,
      ]),
    };
  }
}

function requireOutput(outputs: Record<string, RuntimeTensor>, name: string): RuntimeTensor {
  const output = outputs[name];
  if (!output) throw new Error(`Model output ${name} is missing`);
  return output;
}

function requireFloatOutput(outputs: Record<string, RuntimeTensor>, name: string): Float32Array {
  const data = requireOutput(outputs, name).data;
  if (!(data instanceof Float32Array)) throw new Error(`Model output ${name} is not float32`);
  return data;
}
