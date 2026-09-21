import { expect, test } from "vite-plus/test";
import { constrainedBeamSearch } from "../prototype/constraint-decoding/src/beam.ts";
import {
  curriculumTokens,
  supportsTokenSequence,
} from "../prototype/constraint-decoding/src/constraints.ts";
import {
  buildVocab,
  inferContext,
  tokenizeLatex,
} from "../prototype/constraint-decoding/src/latex.ts";
import { resampleStrokes } from "../prototype/constraint-decoding/src/resample.ts";
import {
  availableExercises,
  PRACTICE_EXERCISES,
} from "../prototype/constraint-decoding/src/practice.ts";
import type {
  RecognitionContext,
  Stroke,
  Vocab,
} from "../prototype/constraint-decoding/src/types.ts";
import { fn } from "../src/index.ts";

test("fn", () => {
  expect(fn()).toBe("Hello, tsdown!");
});

test("fast greedy decoding stops as soon as EOS wins", async () => {
  const tokens = ["<PAD>", "<SOS>", "<EOS>", "<UNK>", "x"];
  const vocab: Vocab = {
    id2token: tokens,
    token2id: new Map(tokens.map((token, index) => [token, index])),
    pad: 0,
    sos: 1,
    eos: 2,
  };
  const context: RecognitionContext = {
    curriculum: "2022",
    schoolLevel: "middle",
    grade: 9,
    subject: "algebra",
    unit: "expression",
    answerType: "expression",
  };
  let decoderCalls = 0;

  const [result] = await constrainedBeamSearch({
    initialState: undefined,
    vocab,
    context,
    mode: "open",
    beamSize: 1,
    maxLength: 24,
    step: async (_state, _lastToken, step) => {
      decoderCalls += 1;
      const logits = new Float32Array(tokens.length).fill(-10);
      logits[step === 0 ? 4 : vocab.eos] = 10;
      return { logits, state: undefined };
    },
  });

  expect(result.tokenIds).toEqual([4]);
  expect(decoderCalls).toBe(2);
});

test("practice formulas fit their grade vocabulary and problem constraints", () => {
  const vocab = buildVocab(curriculumTokens());

  for (const exercise of PRACTICE_EXERCISES) {
    const context: RecognitionContext = {
      curriculum: "2022",
      schoolLevel: exercise.schoolLevel,
      grade: exercise.minGrade,
      subject: exercise.subject,
      unit: exercise.unit,
      answerType: exercise.answerType,
    };
    expect(supportsTokenSequence(vocab, context, "problem", tokenizeLatex(exercise.latex))).toBe(
      true,
    );
  }
});

test("practice formulas follow the selected school level", () => {
  expect(
    availableExercises("elementary").every((exercise) => exercise.schoolLevel === "elementary"),
  ).toBe(true);
  expect(availableExercises("middle").every((exercise) => exercise.schoolLevel === "middle")).toBe(
    true,
  );
  expect(availableExercises("high").every((exercise) => exercise.schoolLevel === "high")).toBe(
    true,
  );
});

test("exercise variables constrain visually similar alternatives", () => {
  const vocab = buildVocab(curriculumTokens());
  const context = inferContext("2x=10");

  expect(supportsTokenSequence(vocab, context, "problem", tokenizeLatex("2x=10"))).toBe(true);
  expect(supportsTokenSequence(vocab, context, "problem", tokenizeLatex("2z=10"))).toBe(false);
});

/** 한 획을 주어진 샘플 개수로 찍는다. 같은 형태, 다른 샘플레이트. */
function arc(samples: number, scale = 1): Stroke {
  return Array.from({ length: samples }, (_, index) => {
    const ratio = index / (samples - 1);
    return {
      x: ratio * 100 * scale,
      y: Math.sin(ratio * Math.PI) * 40 * scale,
      t: ratio * 1000,
    };
  });
}

function countPoints(strokes: Stroke[]): number {
  return strokes.reduce((total, stroke) => total + stroke.length, 0);
}

test("resampling removes the input sample rate", () => {
  // 같은 필기를 50Hz와 240Hz로 받은 상황. 리샘플 후 점 개수가 같아야 한다.
  const slow = resampleStrokes([arc(50)]);
  const fast = resampleStrokes([arc(240)]);

  expect(Math.abs(countPoints(slow) - countPoints(fast))).toBeLessThanOrEqual(1);
  expect(countPoints(fast)).toBeLessThan(240);
});

test("resampling is scale invariant", () => {
  const small = resampleStrokes([arc(120, 1)]);
  const large = resampleStrokes([arc(120, 4)]);

  expect(Math.abs(countPoints(small) - countPoints(large))).toBeLessThanOrEqual(1);
});

test("resampling keeps single-point strokes and stroke endpoints", () => {
  // 소수점과 i의 점은 획 하나에 점 하나다. 사라지면 인식이 깨진다.
  const dot: Stroke = [{ x: 60, y: 90, t: 10 }];
  const [line, kept] = resampleStrokes([arc(200), dot]);

  expect(kept).toEqual(dot);
  expect(line.at(-1)).toEqual(arc(200).at(-1));
  expect(line[0]).toEqual(arc(200)[0]);
});

test("resampling honours the point cap", () => {
  const dense = resampleStrokes([arc(4000)], { spacing: 0.0001, maxPoints: 128 });

  expect(countPoints(dense)).toBeLessThanOrEqual(128);
});

test("resampling leaves a tap alone", () => {
  const tap: Stroke = [
    { x: 5, y: 5, t: 0 },
    { x: 5, y: 5, t: 8 },
  ];

  expect(resampleStrokes([tap])).toEqual([tap]);
});
