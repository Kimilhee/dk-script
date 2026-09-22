export type SchoolLevel = "elementary" | "middle" | "high";

export type AnswerType =
  | "number"
  | "fraction"
  | "expression"
  | "equation"
  | "inequality"
  | "coordinate"
  | "set"
  | "interval"
  | "matrix";

export type DecodeMode = "open" | "level" | "schema" | "problem";

export interface RecognitionContext {
  curriculum: "2022";
  schoolLevel: SchoolLevel;
  grade: number;
  subject: string;
  unit: string;
  answerType: AnswerType;
  allowedVariables?: string[];
  allowedSymbols?: string[];
}

export interface StrokePoint {
  x: number;
  y: number;
  t: number;
  pressure?: number;
}

export type Stroke = StrokePoint[];

export interface Alternative {
  latex: string;
  confidence: number;
}

export interface RecognitionResult {
  latex: string;
  confidence: number;
  alternatives: Alternative[];
  symbols: Array<{ token: string; strokeIds: string[] }>;
  elapsedMs: number;
}

export interface Vocab {
  id2token: string[];
  token2id: Map<string, number>;
  pad: number;
  sos: number;
  eos: number;
}

export interface InkSample {
  id: string;
  truth: string;
  strokes: Stroke[];
  context: RecognitionContext;
}
