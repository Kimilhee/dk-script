import { expect, test } from "vite-plus/test";
import { constrainedBeamSearch } from "../prototype/constraint-decoding/src/beam.ts";
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
