import katex from "katex";
import "katex/dist/katex.min.css";
import "./styles.css";
import type {
  AnswerType,
  DecodeMode,
  RecognitionContext,
  RecognitionResult,
  SchoolLevel,
  Stroke,
} from "./types.ts";

const canvas = element<HTMLCanvasElement>("ink");
const context2d = requireCanvasContext(canvas);
const modes: DecodeMode[] = ["open", "level", "schema", "problem"];
const strokes: Stroke[] = [];
let worker: Worker | undefined;
let current: Stroke | undefined;
let requestId = 0;
let idleTimer: number | undefined;
let ready = false;
let recognitionStartedAt = 0;

resizeCanvas();
window.addEventListener("resize", resizeCanvas);
canvas.addEventListener("pointerdown", pointerDown);
canvas.addEventListener("pointermove", pointerMove);
canvas.addEventListener("pointerup", pointerUp);
canvas.addEventListener("pointercancel", pointerUp);
element<HTMLButtonElement>("clear").addEventListener("click", clear);
element<HTMLButtonElement>("recognize").addEventListener("click", () => void recognize("fast"));
element<HTMLButtonElement>("compare").addEventListener("click", () => void recognize("compare"));
element<HTMLButtonElement>("export-sample").addEventListener("click", exportSample);
setStatus("모델 로딩 중…");
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
  window.clearTimeout(idleTimer);
  idleTimer = window.setTimeout(() => void recognize("fast"), 250);
}

function appendPoint(event: PointerEvent): void {
  if (!current) return;
  const bounds = canvas.getBoundingClientRect();
  current.push({
    x: event.clientX - bounds.left,
    y: event.clientY - bounds.top,
    t: performance.now(),
  });
}

function redraw(): void {
  const bounds = canvas.getBoundingClientRect();
  context2d.clearRect(0, 0, bounds.width, bounds.height);
  context2d.lineCap = "round";
  context2d.lineJoin = "round";
  context2d.lineWidth = 3;
  context2d.strokeStyle = "#182231";
  for (const stroke of strokes) {
    if (stroke.length === 0) continue;
    context2d.beginPath();
    context2d.moveTo(stroke[0].x, stroke[0].y);
    for (const point of stroke.slice(1)) context2d.lineTo(point.x, point.y);
    context2d.stroke();
  }
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
  strokes.splice(0);
  current = undefined;
  redraw();
  for (const mode of modes) renderResult(mode);
  setStatus(ready ? "준비됨" : "모델 로딩 중…");
}

async function recognize(profile: "fast" | "compare"): Promise<void> {
  if (!ready || !worker || strokes.length === 0) return;
  requestId += 1;
  recognitionStartedAt = performance.now();
  const requestedModes: DecodeMode[] = profile === "fast" ? ["problem"] : modes;
  setStatus(profile === "fast" ? "정확 인식 중…" : "네 모드 비교 중…");
  worker.postMessage({
    type: "recognize",
    id: requestId,
    strokes,
    context: readContext(),
    modes: requestedModes,
    profile,
  });
}

function receiveWorkerMessage(event: MessageEvent<WorkerResponse>): void {
  const message = event.data;
  if (message.type === "ready") {
    ready = true;
    setStatus(`준비됨 · cold start ${message.elapsedMs.toFixed(0)}ms`);
    return;
  }
  if (message.type === "error") {
    setStatus(`오류: ${message.message}`);
    return;
  }
  if (message.id !== requestId) return;
  for (const item of message.results) renderResult(item.mode, item.result);
  setStatus(`완료 · 전체 ${(performance.now() - recognitionStartedAt).toFixed(0)}ms`);
}

function readContext(): RecognitionContext {
  const schoolLevel = element<HTMLSelectElement>("school-level").value as SchoolLevel;
  return {
    curriculum: "2022",
    schoolLevel,
    grade: Number(element<HTMLInputElement>("grade").value),
    subject: element<HTMLInputElement>("subject").value,
    unit: element<HTMLInputElement>("unit").value,
    answerType: element<HTMLSelectElement>("answer-type").value as AnswerType,
    allowedVariables: splitInput("variables"),
    allowedSymbols: splitInput("symbols"),
  };
}

function splitInput(id: string): string[] | undefined {
  const values = element<HTMLInputElement>(id)
    .value.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return values.length > 0 ? values : undefined;
}

function renderResult(mode: DecodeMode, result?: RecognitionResult): void {
  const card = element<HTMLElement>(`result-${mode}`);
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
  card.querySelector(".meta")!.textContent =
    `${result.elapsedMs.toFixed(0)}ms · confidence ${(result.confidence * 100).toFixed(1)}%`;
  alternatives.replaceChildren(
    ...result.alternatives.map((item) => {
      const candidate = document.createElement("span");
      renderLatex(candidate, item.latex, false);
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

function exportSample(): void {
  const truth = element<HTMLInputElement>("confirmed-latex").value.trim();
  if (strokes.length === 0) {
    setStatus("내보낼 필기가 없습니다");
    return;
  }
  if (!truth) {
    setStatus("확정 LaTeX를 입력하세요");
    return;
  }

  const context = readContext();
  const traces = strokes
    .map(
      (stroke, index) =>
        `<trace id="${index}">${stroke.map((point) => `${point.x.toFixed(2)} ${point.y.toFixed(2)} ${point.t.toFixed(2)}`).join(", ")}</trace>`,
    )
    .join("\n  ");
  const inkml = `<?xml version="1.0" encoding="UTF-8"?>
<ink xmlns="http://www.w3.org/2003/InkML">
  <annotation type="label">${escapeXml(truth)}</annotation>
  <annotation type="context">${escapeXml(JSON.stringify(context))}</annotation>
  ${traces}
</ink>\n`;
  const url = URL.createObjectURL(new Blob([inkml], { type: "application/inkml+xml" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `math-sample-${new Date().toISOString().replaceAll(":", "-")}.inkml`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
  setStatus("학습 샘플을 로컬에 저장했습니다");
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
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
      type: "results";
      id: number;
      results: Array<{ mode: DecodeMode; result: RecognitionResult }>;
    };
