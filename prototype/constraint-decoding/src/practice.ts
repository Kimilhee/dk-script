import type { AnswerType, SchoolLevel } from "./types.ts";

export interface PracticeExercise {
  latex: string;
  schoolLevel: SchoolLevel;
  minGrade: number;
  maxGrade: number;
  answerType: AnswerType;
  subject: string;
  unit: string;
}

export const PRACTICE_EXERCISES: PracticeExercise[] = [
  ...["3+2", "7-4", "5+4", "9-3"].map((latex) => elementary(latex, 1, 2, "expression")),
  ...["4\\times3", "12\\div4", "25+17", "30-12"].map((latex) =>
    elementary(latex, 3, 4, "expression"),
  ),
  elementary("2.5+1.2", 5, 6, "expression"),
  elementary("\\frac{3}{4}-\\frac{1}{4}", 5, 6, "fraction"),
  ...["x+3=8", "2x=10", "x-4=3"].map((latex) => middle(latex, 7, 7, "equation")),
  middle("x^2=9", 8, 8, "equation"),
  middle("\\sqrt{16}=4", 8, 8, "equation"),
  middle("3^2+4^2=25", 8, 8, "equation"),
  middle("2x+3<9", 9, 9, "inequality"),
  middle("x^2-5x+6=0", 9, 9, "equation"),
  middle("\\frac{x}{2}=3", 9, 9, "equation"),
  high("x^2+2x+1=0", 10, 10, "equation"),
  high("\\alpha+\\beta=\\gamma", 10, 12, "equation"),
  high("\\sum_{i=1}^{3}i=6", 11, 12, "equation"),
  high("\\begin{matrix}1&2\\\\3&4\\end{matrix}", 11, 12, "matrix"),
];

export function availableExercises(schoolLevel: SchoolLevel): PracticeExercise[] {
  return PRACTICE_EXERCISES.filter((exercise) => exercise.schoolLevel === schoolLevel);
}

function elementary(
  latex: string,
  minGrade: number,
  maxGrade: number,
  answerType: AnswerType,
): PracticeExercise {
  return {
    latex,
    schoolLevel: "elementary",
    minGrade,
    maxGrade,
    answerType,
    subject: "arithmetic",
    unit: "numbers",
  };
}

function middle(
  latex: string,
  minGrade: number,
  maxGrade: number,
  answerType: AnswerType,
): PracticeExercise {
  return {
    latex,
    schoolLevel: "middle",
    minGrade,
    maxGrade,
    answerType,
    subject: "algebra",
    unit: "expressions",
  };
}

function high(
  latex: string,
  minGrade: number,
  maxGrade: number,
  answerType: AnswerType,
): PracticeExercise {
  return {
    latex,
    schoolLevel: "high",
    minGrade,
    maxGrade,
    answerType,
    subject: "mathematics",
    unit: "expressions",
  };
}
