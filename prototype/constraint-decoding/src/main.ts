import katex from "katex";
import "katex/dist/katex.min.css";
import "./styles.css";
import { canonicalizeLatex, inferContext } from "./latex.ts";
import { availableExercises, type PracticeExercise } from "./practice.ts";
import type {
  AnswerType,
  RecognitionContext,
  RecognitionResult,
  SchoolLevel,
  Stroke,
} from "./types.ts";

const canvas = element<HTMLCanvasElement>("ink");
const context2d = requireCanvasContext(canvas);
const strokes: Stroke[] = [];
let worker: Worker | undefined;
let current: Stroke | undefined;
let requestId = 0;
let ready = false;
let converting = false;
let recognitionStartedAt = 0;
let exercises: PracticeExercise[] = [];
let exerciseIndex = 0;
let finished = false;
let schoolLevel: SchoolLevel = "middle";
let strokeWidthMode: StrokeWidthMode = "pressure";
let strokeWidth = 3;

resizeCanvas();
updateLevelButtons();
updateInkOptionButtons();
resetPractice();
window.addEventListener("resize", resizeCanvas);
canvas.addEventListener("pointerdown", pointerDown);
canvas.addEventListener("pointermove", pointerMove);
canvas.addEventListener("pointerup", pointerUp);
canvas.addEventListener("pointercancel", pointerUp);
element<HTMLButtonElement>("clear").addEventListener("click", clear);
element<HTMLButtonElement>("convert").addEventListener("click", recognize);
element<HTMLButtonElement>("mark-correct").addEventListener("click", markCorrect);
element<HTMLButtonElement>("retry").addEventListener("click", clear);
element<HTMLButtonElement>("next-exercise").addEventListener("click", nextExercise);
element<HTMLButtonElement>("finish-practice").addEventListener("click", finishPractice);
element<HTMLButtonElement>("restart-practice").addEventListener("click", restartPractice);
element<HTMLElement>("level-picker").addEventListener("click", (event) => {
  if (converting) return;
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-level]");
  if (!button) return;
  schoolLevel = button.dataset.level as SchoolLevel;
  updateLevelButtons();
  resetPractice();
});
element<HTMLElement>("stroke-mode-picker").addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-stroke-mode]");
  if (!button) return;
  strokeWidthMode = button.dataset.strokeMode as StrokeWidthMode;
  updateInkOptionButtons();
  redraw();
});
element<HTMLElement>("stroke-width-picker").addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-stroke-width]");
  if (!button) return;
  strokeWidth = Number(button.dataset.strokeWidth);
  updateInkOptionButtons();
  redraw();
});
setStatus("인식 엔진 준비 중…");
void initialize();

async function initialize(): Promise<void> {
  try {
    if ("serviceWorker" in navigator) {
      await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, {
        scope: import.meta.env.BASE_URL,
      });
      await navigator.serviceWorker.ready;
    }
    worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    worker.addEventListener("message", receiveWorkerMessage);
    worker.addEventListener("error", (event) => setStatus(`Worker 오류: ${event.message}`));
    worker.addEventListener("messageerror", () => setStatus("Worker 메시지 오류"));
    worker.postMessage({ type: "load" });
  } catch (error) {
    setStatus(`초기화 오류: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function pointerDown(event: PointerEvent): void {
  if (finished || converting || !currentExercise()) return;
  requestId += 1;
  hideFeedback();
  canvas.setPointerCapture(event.pointerId);
  current = [];
  strokes.push(current);
  appendPoint(event);
  event.preventDefault();
}

function pointerMove(event: PointerEvent): void {
  if (!current) return;
  const events = event.getCoalescedEvents?.() ?? [event];
  for (const coalesced of events) appendPoint(coalesced);
  redraw();
  event.preventDefault();
}

function pointerUp(event: PointerEvent): void {
  if (!current) return;
  appendPoint(event);
  current = undefined;
  redraw();
}

function appendPoint(event: PointerEvent): void {
  if (!current) return;
  const bounds = canvas.getBoundingClientRect();
  current.push({
    x: event.clientX - bounds.left,
    y: event.clientY - bounds.top,
    t: performance.now(),
    pressure: event.pressure,
  });
}

function redraw(): void {
  const bounds = canvas.getBoundingClientRect();
  context2d.clearRect(0, 0, bounds.width, bounds.height);
  context2d.lineCap = "round";
  context2d.lineJoin = "round";
  context2d.strokeStyle = "#182231";
  for (const stroke of strokes) {
    if (stroke.length === 0) continue;
    if (strokeWidthMode === "pressure") {
      drawPressureStroke(stroke);
      continue;
    }
    context2d.lineWidth = strokeWidth;
    context2d.beginPath();
    context2d.moveTo(stroke[0].x, stroke[0].y);
    for (const point of stroke.slice(1)) context2d.lineTo(point.x, point.y);
    context2d.stroke();
  }
}

function drawPressureStroke(stroke: Stroke): void {
  let width = pressureWidth(stroke[0].pressure);
  for (let index = 1; index < stroke.length; index += 1) {
    const previous = stroke[index - 1];
    const point = stroke[index];
    const targetWidth = pressureWidth(((previous.pressure ?? 0.5) + (point.pressure ?? 0.5)) / 2);
    width = width * 0.7 + targetWidth * 0.3;
    context2d.lineWidth = width;
    context2d.beginPath();
    context2d.moveTo(previous.x, previous.y);
    context2d.lineTo(point.x, point.y);
    context2d.stroke();
  }
}

function pressureWidth(pressure = 0.5): number {
  const normalized = Math.max(0, Math.min(1, pressure));
  return Math.max(0.75, strokeWidth + (normalized - 0.5) * 4);
}

function resizeCanvas(): void {
  const bounds = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.floor(bounds.width * ratio);
  canvas.height = Math.floor(bounds.height * ratio);
  context2d.setTransform(ratio, 0, 0, ratio, 0, 0);
  redraw();
}

function clear(): void {
  if (converting) return;
  requestId += 1;
  strokes.splice(0);
  current = undefined;
  redraw();
  renderResult();
  hideFeedback();
  setStatus(ready ? "준비됨" : "인식 엔진 준비 중…");
}

function recognize(): void {
  if (!ready || !worker || strokes.length === 0 || finished || converting) return;
  requestId += 1;
  converting = true;
  recognitionStartedAt = performance.now();
  element<HTMLButtonElement>("convert").disabled = true;
  element<HTMLButtonElement>("clear").disabled = true;
  for (const button of element<HTMLElement>("level-picker").querySelectorAll<HTMLButtonElement>(
    "button",
  )) {
    button.disabled = true;
  }
  setStatus("변환 중…");
  worker.postMessage({
    type: "recognize",
    id: requestId,
    strokes,
    context: exerciseContext(),
  });
}

function receiveWorkerMessage(event: MessageEvent<WorkerResponse>): void {
  const message = event.data;
  if (message.type === "ready") {
    ready = true;
    element<HTMLButtonElement>("convert").disabled = false;
    setStatus("준비됨");
    return;
  }
  if (message.type === "error") {
    if (message.id !== undefined && message.id !== requestId) return;
    converting = false;
    element<HTMLButtonElement>("convert").disabled = false;
    element<HTMLButtonElement>("clear").disabled = false;
    for (const button of element<HTMLElement>("level-picker").querySelectorAll<HTMLButtonElement>(
      "button",
    )) {
      button.disabled = false;
    }
    setStatus(`오류: ${message.message}`);
    return;
  }
  if (message.id !== requestId) return;
  if (message.type === "result") {
    const conversionMs = performance.now() - recognitionStartedAt;
    renderResult(message.result);
    showFeedback(
      canonicalizeLatex(message.result.latex) === canonicalizeLatex(currentExercise()?.latex ?? ""),
    );
    setStatus(`변환 완료 · ${conversionMs.toFixed(0)}ms`);
    return;
  }
  converting = false;
  element<HTMLButtonElement>("convert").disabled = false;
  element<HTMLButtonElement>("clear").disabled = false;
  for (const button of element<HTMLElement>("level-picker").querySelectorAll<HTMLButtonElement>(
    "button",
  )) {
    button.disabled = false;
  }
}

function readContext(): RecognitionContext {
  const grade = schoolLevel === "elementary" ? 6 : schoolLevel === "middle" ? 9 : 12;
  const exercise = currentExercise();
  return {
    curriculum: "2022",
    schoolLevel,
    grade,
    subject: exercise?.subject ?? "algebra",
    unit: exercise?.unit ?? "expressions",
    answerType: exercise?.answerType ?? ("expression" satisfies AnswerType),
  };
}

function exerciseContext(): RecognitionContext {
  const exercise = currentExercise();
  const context = readContext();
  if (!exercise) return context;
  const exerciseConstraints = inferContext(exercise.latex);
  return {
    ...context,
    answerType: exercise.answerType,
    allowedVariables: exerciseConstraints.allowedVariables,
    allowedSymbols: exerciseConstraints.allowedSymbols,
  };
}

function resetPractice(): void {
  exercises = availableExercises(schoolLevel);
  exerciseIndex = 0;
  finished = false;
  element<HTMLElement>("practice-finished").hidden = true;
  renderExercise();
  clear();
}

function renderExercise(): void {
  const exercise = currentExercise();
  const prompt = element<HTMLElement>("exercise-prompt");
  if (!exercise) {
    prompt.hidden = true;
    element<HTMLElement>("no-exercises").hidden = false;
    element<HTMLElement>("practice-feedback").hidden = true;
    return;
  }
  prompt.hidden = false;
  element<HTMLElement>("no-exercises").hidden = true;
  element<HTMLElement>("exercise-count").textContent = `${exerciseIndex + 1} / ${exercises.length}`;
  renderLatex(element<HTMLElement>("exercise-latex"), exercise.latex);
  hideFeedback();
}

function updateLevelButtons(): void {
  for (const button of element<HTMLElement>("level-picker").querySelectorAll<HTMLButtonElement>(
    "[data-level]",
  )) {
    button.setAttribute("aria-pressed", String(button.dataset.level === schoolLevel));
  }
}

function updateInkOptionButtons(): void {
  for (const button of element<HTMLElement>(
    "stroke-mode-picker",
  ).querySelectorAll<HTMLButtonElement>("[data-stroke-mode]")) {
    button.setAttribute("aria-pressed", String(button.dataset.strokeMode === strokeWidthMode));
  }
  for (const button of element<HTMLElement>(
    "stroke-width-picker",
  ).querySelectorAll<HTMLButtonElement>("[data-stroke-width]")) {
    button.setAttribute("aria-pressed", String(Number(button.dataset.strokeWidth) === strokeWidth));
  }
}

function currentExercise(): PracticeExercise | undefined {
  return exercises[exerciseIndex];
}

function nextExercise(): void {
  if (exercises.length === 0) return;
  exerciseIndex = (exerciseIndex + 1) % exercises.length;
  finished = false;
  renderExercise();
  clear();
}

function finishPractice(): void {
  finished = true;
  element<HTMLElement>("practice-feedback").hidden = true;
  element<HTMLElement>("practice-finished").hidden = false;
  setStatus("연습을 마쳤습니다");
}

function restartPractice(): void {
  element<HTMLElement>("practice-finished").hidden = true;
  resetPractice();
}

function showFeedback(matches: boolean): void {
  if (finished) return;
  const feedback = element<HTMLElement>("practice-feedback");
  feedback.hidden = false;
  element<HTMLElement>("feedback-message").textContent = matches
    ? "정답이에요! 다음 수식으로 넘어갈까요?"
    : "제시한 수식과 다르게 인식했어요. 다시 쓰거나 정답으로 확인해 주세요.";
  element<HTMLButtonElement>("mark-correct").hidden = matches;
  element<HTMLButtonElement>("retry").hidden = matches;
  element<HTMLButtonElement>("next-exercise").hidden = !matches;
  element<HTMLButtonElement>("finish-practice").hidden = !matches;
}

function markCorrect(): void {
  element<HTMLElement>("feedback-message").textContent =
    "정답으로 표시했어요. 다음 수식으로 넘어갈까요?";
  element<HTMLButtonElement>("mark-correct").hidden = true;
  element<HTMLButtonElement>("retry").hidden = true;
  element<HTMLButtonElement>("next-exercise").hidden = false;
  element<HTMLButtonElement>("finish-practice").hidden = false;
}

function hideFeedback(): void {
  element<HTMLElement>("practice-feedback").hidden = true;
}

function renderResult(result?: RecognitionResult): void {
  const card = element<HTMLElement>("result-problem");
  const latex = card.querySelector<HTMLElement>(".latex")!;
  const alternatives = card.querySelector<HTMLElement>(".alternatives")!;
  if (!result) {
    latex.textContent = "—";
    latex.removeAttribute("title");
    card.querySelector(".meta")!.textContent = "";
    alternatives.replaceChildren();
    return;
  }
  renderLatex(latex, result.latex);
  card.querySelector(".meta")!.textContent = `신뢰도 ${(result.confidence * 100).toFixed(1)}%`;
  alternatives.replaceChildren(
    ...result.alternatives.slice(0, 3).map((item, index) => {
      const candidate = document.createElement("span");
      candidate.className = "candidate";
      const rank = document.createElement("strong");
      rank.textContent = `${index + 2}순위`;
      const value = document.createElement("span");
      renderLatex(value, item.latex, false);
      const confidence = document.createElement("small");
      confidence.textContent = `${(item.confidence * 100).toFixed(1)}%`;
      candidate.append(rank, value, confidence);
      return candidate;
    }),
  );
}

function renderLatex(target: HTMLElement, value: string, displayMode = true): void {
  const latex = value || "\\varnothing";
  target.title = value;
  katex.render(latex, target, {
    displayMode,
    throwOnError: false,
    strict: "ignore",
    trust: false,
  });
}

function setStatus(value: string): void {
  element<HTMLElement>("status").textContent = value;
}

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`#${id} is missing`);
  return found as T;
}

function requireCanvasContext(target: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = target.getContext("2d");
  if (!context) throw new Error("Canvas 2D is unavailable");
  return context;
}

type WorkerResponse =
  | { type: "ready"; elapsedMs: number }
  | { type: "error"; id?: number; message: string }
  | {
      type: "result";
      id: number;
      result: RecognitionResult;
    }
  | { type: "complete"; id: number };

type StrokeWidthMode = "pressure" | "constant";
