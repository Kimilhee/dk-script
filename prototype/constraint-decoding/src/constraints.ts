import type { AnswerType, DecodeMode, RecognitionContext, SchoolLevel, Vocab } from "./types.ts";

const STRUCTURAL = new Set(["_", "^", "{", "}", " "]);
const SPECIAL = new Set(["<EOS>", "<PAD>", "<SOS>", "<UNK>"]);
const DIGITS = new Set("0123456789".split(""));
const LETTERS = new Set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ".split(""));

const ELEMENTARY = new Set([
  ...DIGITS,
  ...STRUCTURAL,
  "+",
  "-",
  "=",
  "<",
  ">",
  "\\le",
  "\\ge",
  "\\ne",
  "\\times",
  "\\div",
  "\\frac",
  ".",
  ",",
  ":",
  "(",
  ")",
  "\\%",
  "\\circ",
]);

const MIDDLE = new Set([
  ...ELEMENTARY,
  ...LETTERS,
  "\\sqrt",
  "\\pi",
  "\\pm",
  "\\angle",
  "\\triangle",
  "\\perp",
  "\\equiv",
  "\\cong",
  "\\sim",
  "\\propto",
  "|",
  "\\|",
  "[",
  "]",
]);

const HIGH = new Set([
  ...MIDDLE,
  "\\alpha",
  "\\beta",
  "\\gamma",
  "\\theta",
  "\\sigma",
  "\\Sigma",
  "\\int",
  "\\sum",
  "\\prod",
  "\\infty",
  "\\partial",
  "\\prime",
  "\\overline",
  "\\vec",
  "\\in",
  "\\notin",
  "\\subset",
  "\\subseteq",
  "\\emptyset",
  "\\cup",
  "\\cap",
  "\\rightarrow",
  "\\Rightarrow",
  "\\Leftrightarrow",
  "\\iff",
  "!",
  "\\begin{matrix}",
  "\\end{matrix}",
  "&",
  "\\\\",
]);

const NUMBER_TOKENS = new Set([...DIGITS, "+", "-", ".", ","]);
const FRACTION_TOKENS = new Set([...NUMBER_TOKENS, "\\frac", "{", "}"]);
const COORDINATE_TOKENS = new Set([
  ...NUMBER_TOKENS,
  ...LETTERS,
  "(",
  ")",
  ",",
  "\\frac",
  "\\sqrt",
  "{",
  "}",
  "^",
  "_",
]);
const INTERVAL_TOKENS = new Set([...COORDINATE_TOKENS, "[", "]", "\\infty"]);
const SET_TOKENS = new Set([
  ...COORDINATE_TOKENS,
  "\\{",
  "\\}",
  "\\in",
  "\\notin",
  "\\subset",
  "\\subseteq",
  "\\emptyset",
  "\\cup",
  "\\cap",
  "|",
]);
const MATRIX_TOKENS = new Set([
  ...NUMBER_TOKENS,
  ...LETTERS,
  "\\begin{matrix}",
  "\\end{matrix}",
  "&",
  "\\\\",
  "{",
  "}",
  "\\frac",
  "\\sqrt",
  "^",
  "_",
]);

/**
 * 제약 레이어가 허용할 수 있는 모든 토큰. `buildVocab`에 바로 넣을 수 있는 형태다.
 *
 * 연구용 모델의 `vocab.json`은 다운로드 자산이라 Git에 없다. 커리큘럼 자체를
 * 검증하는 테스트는 연구 자산 없이도 돌아야 하므로 이 집합으로 vocab을 만든다.
 * HIGH는 MIDDLE·ELEMENTARY를 누적 포함한다.
 */
export function curriculumTokens(): Record<string, string[]> {
  return {
    special: [...SPECIAL],
    curriculum: [
      ...new Set([
        ...HIGH,
        ...NUMBER_TOKENS,
        ...FRACTION_TOKENS,
        ...COORDINATE_TOKENS,
        ...INTERVAL_TOKENS,
        ...SET_TOKENS,
        ...MATRIX_TOKENS,
      ]),
    ],
  };
}

export interface PrefixState {
  braceDepth: number;
  tokens: string[];
}

export function initialPrefixState(): PrefixState {
  return { braceDepth: 0, tokens: [] };
}

export function advancePrefix(state: PrefixState, token: string): PrefixState {
  return {
    braceDepth: state.braceDepth + (token === "{" ? 1 : token === "}" ? -1 : 0),
    tokens: [...state.tokens, token],
  };
}

export function allowedTokenIds(
  vocab: Vocab,
  context: RecognitionContext,
  mode: DecodeMode,
  state: PrefixState,
): Set<number> {
  const allowed = new Set<number>();
  for (let id = 0; id < vocab.id2token.length; id += 1) {
    const token = vocab.id2token[id];
    if (token === "<PAD>" || token === "<SOS>" || token === "<UNK>") continue;
    if (token === "<EOS>") {
      if (canFinish(state, context, mode)) allowed.add(id);
      continue;
    }
    if (mode !== "open" && !tokensForLevel(context.schoolLevel).has(token)) continue;
    if (
      (mode === "schema" || mode === "problem") &&
      !tokensForAnswer(context.answerType, context.schoolLevel).has(token)
    )
      continue;
    if (mode === "problem" && !isProblemTokenAllowed(token, context)) continue;
    if (!isPrefixValid(state, token, mode)) continue;
    allowed.add(id);
  }
  return allowed;
}

export function supportsTokenSequence(
  vocab: Vocab,
  context: RecognitionContext,
  mode: DecodeMode,
  tokens: string[],
): boolean {
  let state = initialPrefixState();
  for (const token of tokens) {
    const id = vocab.token2id.get(token);
    if (id === undefined || !allowedTokenIds(vocab, context, mode, state).has(id)) return false;
    state = advancePrefix(state, token);
  }
  return allowedTokenIds(vocab, context, mode, state).has(vocab.eos);
}

function tokensForLevel(level: SchoolLevel): Set<string> {
  if (level === "elementary") return ELEMENTARY;
  if (level === "middle") return MIDDLE;
  return HIGH;
}

function tokensForAnswer(type: AnswerType, level: SchoolLevel): Set<string> {
  if (type === "number") return NUMBER_TOKENS;
  if (type === "fraction") return FRACTION_TOKENS;
  if (type === "coordinate") return COORDINATE_TOKENS;
  if (type === "interval") return INTERVAL_TOKENS;
  if (type === "set") return SET_TOKENS;
  if (type === "matrix") return MATRIX_TOKENS;
  return tokensForLevel(level);
}

function isProblemTokenAllowed(token: string, context: RecognitionContext): boolean {
  if (STRUCTURAL.has(token) || DIGITS.has(token) || SPECIAL.has(token)) return true;
  if (LETTERS.has(token)) {
    return context.allowedVariables ? context.allowedVariables.includes(token) : true;
  }
  return context.allowedSymbols ? context.allowedSymbols.includes(token) : true;
}

function isPrefixValid(state: PrefixState, token: string, mode: DecodeMode): boolean {
  if (mode === "open" || mode === "level") return true;
  if (token === "}" && state.braceDepth === 0) return false;
  const previous = state.tokens.at(-1);
  if (["\\frac", "\\sqrt", "^", "_"].includes(previous ?? "")) {
    return token === "{" || isAtom(token);
  }
  return true;
}

function isAtom(token: string): boolean {
  return DIGITS.has(token) || LETTERS.has(token) || token === "(" || token === "\\pi";
}

function canFinish(state: PrefixState, context: RecognitionContext, mode: DecodeMode): boolean {
  if (state.tokens.length === 0) return false;
  if (mode === "open" || mode === "level") return true;
  if (state.braceDepth !== 0) return false;
  const tokens = new Set(state.tokens);
  if (context.answerType === "fraction" && !tokens.has("\\frac")) return false;
  if (context.answerType === "equation" && !tokens.has("=")) return false;
  if (
    context.answerType === "inequality" &&
    !["<", ">", "\\le", "\\ge", "\\ne"].some((token) => tokens.has(token))
  ) {
    return false;
  }
  if (context.answerType === "matrix" && !tokens.has("\\end{matrix}")) return false;
  return true;
}
