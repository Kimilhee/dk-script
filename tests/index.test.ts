import { expect, test } from "vite-plus/test";
import { constrainedBeamSearch } from "../prototype/constraint-decoding/src/beam.ts";
import {
  curriculumTokens,
  supportsTokenSequence,
} from "../prototype/constraint-decoding/src/constraints.ts";
import { buildVocab, tokenizeLatex } from "../prototype/constraint-decoding/src/latex.ts";
import {
  availableExercises,
  PRACTICE_EXERCISES,
} from "../prototype/constraint-decoding/src/practice.ts";
import type { RecognitionContext, Vocab } from "../prototype/constraint-decoding/src/types.ts";
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

test("practice formulas follow the selected school level, grade, and allowed variables", () => {
  const context: RecognitionContext = {
    curriculum: "2022",
    schoolLevel: "elementary",
    grade: 2,
    subject: "arithmetic",
    unit: "numbers",
    answerType: "expression",
  };

  expect(availableExercises(context).every((exercise) => exercise.minGrade <= 2)).toBe(true);
  expect(availableExercises({ ...context, grade: 7 })).toEqual([]);
  expect(
    availableExercises({ ...context, schoolLevel: "middle", grade: 7, allowedVariables: ["y"] }),
  ).toEqual([]);
});
