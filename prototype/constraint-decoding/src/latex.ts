import type { AnswerType, RecognitionContext, SchoolLevel, Vocab } from "./types.ts";

const COMMAND = /\\(?:begin|end)\{[A-Za-z0-9*]+\}|\\[A-Za-z]+|\\[^A-Za-z\s]/y;

const ALIASES = new Map([
  ["\\dfrac", "\\frac"],
  ["\\tfrac", "\\frac"],
  ["\\neq", "\\ne"],
  ["\\leq", "\\le"],
  ["\\geq", "\\ge"],
  ["\\empty", "\\emptyset"],
]);

export function tokenizeLatex(input: string): string[] {
  const normalized = input.replaceAll("\\left", "").replaceAll("\\right", "").trim();
  const tokens: string[] = [];

  for (let index = 0; index < normalized.length;) {
    const character = normalized[index];
    if (/\s/u.test(character)) {
      index += 1;
      continue;
    }
    if (character === "\\") {
      COMMAND.lastIndex = index;
      const match = COMMAND.exec(normalized);
      if (match) {
        tokens.push(ALIASES.get(match[0]) ?? match[0]);
        index = COMMAND.lastIndex;
        continue;
      }
    }
    tokens.push(character);
    index += 1;
  }
  return tokens;
}

export function canonicalizeLatex(input: string): string {
  return tokenizeLatex(input).join("");
}

export function isStructurallyValidLatex(input: string): boolean {
  const tokens = tokenizeLatex(input);
  const delimiters: string[] = [];
  const environments: string[] = [];

  for (const token of tokens) {
    if (token === "{" || token === "(" || token === "[") {
      delimiters.push(token);
      continue;
    }
    if (token === "}" || token === ")" || token === "]") {
      const opening = delimiters.pop();
      if (
        (token === "}" && opening !== "{") ||
        (token === ")" && opening !== "(") ||
        (token === "]" && opening !== "[")
      ) {
        return false;
      }
      continue;
    }
    const begin = /^\\begin\{([^}]+)\}$/u.exec(token);
    if (begin) {
      environments.push(begin[1]);
      continue;
    }
    const end = /^\\end\{([^}]+)\}$/u.exec(token);
    if (end && environments.pop() !== end[1]) return false;
  }

  return delimiters.length === 0 && environments.length === 0;
}

export function buildVocab(categories: Record<string, string[]>): Vocab {
  const id2token = Object.values(categories).flat();
  const token2id = new Map(id2token.map((token, index) => [token, index]));
  return {
    id2token,
    token2id,
    pad: requireToken(token2id, "<PAD>"),
    sos: requireToken(token2id, "<SOS>"),
    eos: requireToken(token2id, "<EOS>"),
  };
}

function requireToken(tokens: Map<string, number>, token: string): number {
  const id = tokens.get(token);
  if (id === undefined) throw new Error(`Vocabulary is missing ${token}`);
  return id;
}

export function inferContext(truth: string): RecognitionContext {
  const canonical = canonicalizeLatex(truth);
  const tokens = tokenizeLatex(canonical);
  const schoolLevel = inferSchoolLevel(canonical);
  const answerType = inferAnswerType(canonical);
  const variables = tokens.filter((token) => /^[a-zA-Z]$/u.test(token));
  const symbols = tokens.filter(
    (token) => !/^[a-zA-Z0-9]$/u.test(token) && !["_", "^", "{", "}", " "].includes(token),
  );

  return {
    curriculum: "2022",
    schoolLevel,
    grade: schoolLevel === "elementary" ? 6 : schoolLevel === "middle" ? 9 : 12,
    subject: inferSubject(canonical, schoolLevel),
    unit: inferUnit(canonical, answerType),
    answerType,
    allowedVariables: [...new Set(variables)],
    allowedSymbols: [...new Set(symbols)],
  };
}

function inferSchoolLevel(latex: string): SchoolLevel {
  if (
    /\\(?:int|sum|prod|lim|infty|log|ln|partial|begin\{matrix\}|in|notin|subset|cup|cap)|\[|\]/u.test(
      latex,
    )
  ) {
    return "high";
  }
  if (/\\(?:sqrt|pi|angle|triangle|perp|equiv|sim|pm)|[a-zA-Z_^]/u.test(latex)) {
    return "middle";
  }
  return "elementary";
}

function inferAnswerType(latex: string): AnswerType {
  if (latex.includes("\\begin{matrix}")) return "matrix";
  if (/\\(?:in|notin|subset|cup|cap|emptyset)|\\\{|\\\}/u.test(latex)) return "set";
  if (/^(?:\[|\().*,.*(?:\]|\))$/u.test(latex)) {
    return /\[|\]/u.test(latex) ? "interval" : "coordinate";
  }
  if (/\\(?:le|ge|ne)|[<>]/u.test(latex)) return "inequality";
  if (latex.includes("=")) return "equation";
  if (latex.includes("\\frac")) return "fraction";
  if (/^[+-]?[0-9.,]+$/u.test(latex)) return "number";
  return "expression";
}

function inferSubject(latex: string, level: SchoolLevel): string {
  if (/\\(?:int|lim|sum)/u.test(latex)) return "calculus";
  if (/\\(?:in|subset|cup|cap|emptyset)/u.test(latex)) return "sets";
  if (latex.includes("\\begin{matrix}")) return "matrices";
  if (/\\(?:angle|triangle|perp)|\\pi/u.test(latex)) return "geometry";
  return level === "elementary" ? "arithmetic" : "algebra";
}

function inferUnit(latex: string, answerType: AnswerType): string {
  if (latex.includes("\\sqrt")) return "radicals";
  if (latex.includes("^")) return "powers";
  return answerType;
}

export function tokenEditDistance(left: string, right: string): number {
  const a = tokenizeLatex(left);
  const b = tokenizeLatex(right);
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length];
}
