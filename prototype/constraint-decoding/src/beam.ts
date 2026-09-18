import {
  advancePrefix,
  allowedTokenIds,
  initialPrefixState,
  type PrefixState,
} from "./constraints.ts";
import type { DecodeMode, RecognitionContext, Vocab } from "./types.ts";

export interface DecoderOutput<State> {
  logits: Float32Array;
  state: State;
}

export type DecoderStep<State> = (
  state: State,
  lastToken: number,
  step: number,
) => Promise<DecoderOutput<State>>;

export interface DecodedCandidate {
  tokenIds: number[];
  score: number;
  confidence: number;
}

interface Beam<State> {
  tokenIds: number[];
  score: number;
  modelState: State;
  prefix: PrefixState;
  finished: boolean;
}

export async function constrainedBeamSearch<State>(options: {
  initialState: State;
  step: DecoderStep<State>;
  vocab: Vocab;
  context: RecognitionContext;
  mode: DecodeMode;
  beamSize?: number;
  maxLength?: number;
}): Promise<DecodedCandidate[]> {
  const beamSize = options.beamSize ?? 3;
  const maxLength = options.maxLength ?? 64;
  let beams: Beam<State>[] = [
    {
      tokenIds: [],
      score: 0,
      modelState: options.initialState,
      prefix: initialPrefixState(),
      finished: false,
    },
  ];

  for (let index = 0; index < maxLength; index += 1) {
    const expanded: Beam<State>[] = [];
    for (const beam of beams) {
      if (beam.finished) {
        expanded.push(beam);
        continue;
      }
      const lastToken = beam.tokenIds.at(-1) ?? options.vocab.sos;
      const output = await options.step(beam.modelState, lastToken, index);
      const allowed = allowedTokenIds(options.vocab, options.context, options.mode, beam.prefix);
      const choices = topLogProbabilities(output.logits, allowed, beamSize);
      for (const choice of choices) {
        const token = options.vocab.id2token[choice.id];
        const finished = choice.id === options.vocab.eos;
        expanded.push({
          tokenIds: finished ? beam.tokenIds : [...beam.tokenIds, choice.id],
          score: beam.score + choice.logProbability,
          modelState: output.state,
          prefix: finished ? beam.prefix : advancePrefix(beam.prefix, token),
          finished,
        });
      }
    }
    beams = expanded
      .sort((left, right) => normalizedScore(right) - normalizedScore(left))
      .slice(0, beamSize);
    if (beams.every((beam) => beam.finished)) break;
  }

  const scores = beams.map(normalizedScore);
  const maxScore = Math.max(...scores);
  const weights = scores.map((score) => Math.exp(score - maxScore));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  return beams.map((beam, index) => ({
    tokenIds: beam.tokenIds,
    score: scores[index],
    confidence: weights[index] / total,
  }));
}

function normalizedScore<State>(beam: Beam<State>): number {
  const penalty = ((5 + Math.max(1, beam.tokenIds.length)) / 6) ** 0.6;
  return beam.score / penalty;
}

function topLogProbabilities(
  logits: Float32Array,
  allowed: Set<number>,
  count: number,
): Array<{ id: number; logProbability: number }> {
  const candidates = [...allowed].map((id) => ({
    id,
    logit: logits[id] ?? Number.NEGATIVE_INFINITY,
  }));
  if (candidates.length === 0) throw new Error("Constraint grammar left no valid decoder token");
  const maximum = Math.max(...candidates.map((candidate) => candidate.logit));
  const normalizer =
    maximum +
    Math.log(candidates.reduce((sum, candidate) => sum + Math.exp(candidate.logit - maximum), 0));
  return candidates
    .map(({ id, logit }) => ({ id, logProbability: logit - normalizer }))
    .sort((left, right) => right.logProbability - left.logProbability)
    .slice(0, count);
}
