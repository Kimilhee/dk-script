<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, and it invokes Vite through `vp dev` and `vp build`. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

## Built-in Commands vs Scripts

`vp <name>` runs a built-in command. `vp run <name>` runs a `package.json` script or a `vite.config.ts` task. Scripts cannot overwrite built-ins, so `vp dev` and `vp run dev` may do different things. Check `package.json` and `vite.config.ts` first, and run `vp run <name>` when the project defines a script or task with that name.

## Tool Versions

Run `vp toolchain` to show versions and relationships in the active Vite+
release. Add a tool name to select part of the graph. For example, run
`vp toolchain vite`. Use `--global` to ignore the local `vite-plus` package. Use
`vp why <package>` to show the package-manager dependency graph.

## Review Checklist

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to format, lint, type check and test changes.
- [ ] Check if there are `vite.config.ts` tasks or `package.json` scripts necessary for validation, run via `vp run <script>`.
- [ ] If setup, runtime, or package-manager behavior looks wrong, run `vp env doctor` and include its output when asking for help.

<!--VITE PLUS END-->

# dk-script — 온디바이스 수식 필기 인식 라이브러리

> 이 문서는 **확정된 사실**과 **검증할 가설**을 구분해서 쓴다. 가설에는 `[가설]`을 붙이고 판단 기준과 판단 시점을 함께 적는다. 근거 없이 가설을 사실로 승격시키지 마라.

## 1. 무엇을 만드는가

브라우저에서 **손으로 쓴 수식을 LaTeX로 변환**하는 JS/WASM 라이브러리와 reference PWA. 의존성 수 자체가 아니라 P580/P610 실측 정확도·지연·배포 크기로 런타임을 선택한다.

**확정된 제품 결정:**

- **상용 서비스다.** 라이선스 판단은 전부 상업적 이용 가능 여부를 기준으로 한다. (6장이 이 결정의 직접적 결과이고, 이 프로젝트 최대의 리스크다.)
- **채점은 범위 밖.** 우리 책임은 잉크 → LaTeX 문자열까지. 정답 비교·수학적 동치 판정은 호출자 몫이다.
- **2022 개정** 한국 초/중/고 수학 교육과정 범위만. 대학 수학·물리 표기는 대상 밖.
- **학생의 "답안"만** 인식. 서술형 풀이·여러 줄 증명이 아니라 대부분 25심볼 이하인 수식 블록 하나다.
- 사용자가 학교급을 고르지 않는다. 호출자가 문제 정보에서 `schoolLevel / grade / subject / unit / answerType / allowedVariables / allowedSymbols`를 전달하고, 신뢰 가능한 문제 메타데이터를 hard constraint로 쓴다.
- 한글/영문 단어 인식은 범위 밖 (단위 `cm`, 함수명 `sin` 등 고정 토큰만 예외).

**비기능 요건 (타협 불가):**

- 100% 온디바이스. 런타임에 네트워크 호출 없음. 모델 로딩조차 동일 출처/로컬 파일.
- 1차 타깃: **삼성 SM-P580과 SM-P610의 Android Chrome**. WebGPU·NPU는 없다고 보고 WASM CPU를 기준으로 한다.
- 앱 설치 또는 최초 온라인 실행 때 모델을 받아 versioned Cache Storage에 저장하고, 그 뒤에는 네트워크 없이 동작한다.

## 2. 아키텍처

### 확정: 입력은 이미지가 아니라 펜 궤적(digital ink)이다

이건 가설이 아니라 결정이다. 이미지로 렌더해서 OCR하는 경로는 획 순서·속도·필압을 버리고, 증분 갱신도 못 한다. `PointerEvent` 궤적을 그대로 쓴다.

### [가설] 고전 파이프라인은 production 후보 중 하나다

```
PointerEvent
  → ink       잉크 캡처 · 리샘플 · 정규화        → Stroke[]
  → segment   획 그룹화 (지연 획 포함)           → SymbolCandidate[]
  → classify  심볼 분류 (학년 마스킹된 top-k)    → ScoredSymbol[]
  → layout    심볼 쌍 공간관계 → 최대신장트리    → StructureTree
  → grammar   학년별 문법 검증 + 후보 재랭킹     → StructureTree (rescored)
  → emit      트리 → 정규화 LaTeX                → RecognitionResult
```

각 단계는 `src/<stage>/` 디렉터리 하나에 대응한다.
**당장 워크스페이스 패키지로 쪼개지 마라.** 단일 패키지 + 디렉터리로 시작하고, 어떤 단계가 독립 버저닝을 필요로 할 때만 분리한다.

이 구조는 심볼 단위 라벨과 합성 수식을 활용하기 쉽지만, 아직 최종 구조가 아니다. **먼저 P0에서 모델을 고정한 채 curriculum constraint의 순효과를 측정한다.** 효과가 확인된 뒤에만 같은 자체 데이터로 이 구조와 compact online joint model을 비교한다.

보조 근거:

- **증분 출력 안정성.** 획 하나를 추가했을 때 바뀐 심볼만 갱신되므로 앞부분 출력이 흔들리지 않는다. seq2seq 디코더를 매 획마다 재실행하면 이전 토큰까지 바뀌어 화면이 튄다 — 해결 불가능한 문제는 아니지만 추가 설계가 필요하다.
- **디버깅 가능성.** 오답이 세그멘테이션·분류·구조 중 어디서 났는지 격리된다. 초기 개발 속도에 실질적 이득.
- **크기.** 분류기 ≤300K + 관계 MLP <10K 파라미터. P580 예산에 여유 있게 들어간다.

### 이 구조의 알려진 약점 — 반드시 완화하라

**캐스케이드 오류 전파.** 세그멘테이션이 틀리면 뒤 단계가 복구할 수 없고, 이게 정확도 상한을 만든다. CROHME 리더보드가 2018년 이후 end-to-end로 넘어간 주된 이유다.

완화는 **선택이 아니라 필수 요구사항**이다:

- 어떤 단계도 **단일 정답을 확정해서 넘기지 않는다.** 항상 스코어 붙은 후보 집합을 넘긴다.
- 최종 선택은 세그멘테이션 × 분류 × 관계를 **결합 스코어로 빔서치**해서 한다. 답안이 25심볼 이하라 비용상 가능하다.
- 단계별 정확도가 아니라 **표현식 단위 정확도**로만 구조를 평가한다 (7장).

### [가설 검증] 자체 수식 잉크가 확보되면 소형 online joint model과 붙인다

고전 파이프라인이 최종 구조라고 확정하지 마라. **온라인 스트로크 입력 Transformer(수백만 파라미터급)는 유효한 경쟁 후보다.**

이미지 모델(pix2tex ~20–30M, Nougat 250M+, Texify·UniMERNet 200M+)이 P580에서 불가능한 건 맞지만, **그 논거를 온라인 잉크 seq2seq에 그대로 전가하면 안 된다.** 다음은 사실이 아니므로 근거로 쓰지 마라:

- ~~"end-to-end는 전부 100M+다"~~ — 온라인 잉크 모델은 수백만 파라미터로 만들 수 있다.
- ~~"seq2seq는 학년별 마스킹이 안 된다"~~ — 디코더 vocab 마스킹은 스텝마다 걸면 되고 구현이 쉽다.
- ~~"seq2seq는 증분 처리가 불가능하다"~~ — encoder 상태 캐시와 부분 재계산이 가능하고, 짧은 답안이면 디코더 전체 재실행도 예산에 들어올 수 있다.

**비교 조건** — 같은 자체 수집 데이터로 학습해 같은 골든셋에서 측정하고, 아래 4개를 모두 보고한다:

1. 학년군별 표현식 단위 정확도
2. P580 실측 지연 p95 (획 추가 시 / 최종 확정 시)
3. **증분 출력 안정성** — 획을 추가할 때 이전 출력 토큰이 바뀌는 비율
4. 모델 + 런타임 합계 크기

seq2seq가 이기면 갈아탄다. 결과는 이 문서에 기록하고 `[가설]` 표기를 제거한다.

### 단계별 구현 노트

**ink** — `PointerEvent`의 coalesced events까지 받아라 (저사양 기기일수록 이벤트가 뭉쳐 들어온다). 등간격 재샘플 → 크기/기울기 정규화. 픽셀 좌표는 이 단계 밖으로 절대 내보내지 않는다. 교환 포맷은 **InkML** (자체 수집·평가 도구가 표준 포맷을 쓰면 편하다).

**segment** — 시간 순서만으로 묶으면 반드시 실패한다. **지연 획(delayed stroke)** 처리가 이 단계의 전부다:
`=` `÷` `≠` `≤` `≥`, `i`/`j`의 점, `t`/`7`/`4`의 가로획, 분수 바를 긋고 분자·분모를 쓰는 순서, `x`를 두 획으로 쓰는 습관, 지우고 덧쓰기.
→ 시간 인접 그룹핑(최대 4획)으로 후보를 만들고, **공간 겹침 기반 재결합**을 반드시 추가한다.

**classify** — 32×32 렌더 비트맵 CNN으로 시작. 파라미터 ≤300K, int8 양자화 후 ~300KB 목표.
궤적 브랜치(리샘플 64포인트 × 6피처, 1D-CNN)는 `x` vs `×`처럼 획순이 결정적인 케이스에서만 이득이 있으니 **M3 이후에** 추가한다.
학년 게이팅은 여기서 **로짓 마스킹**으로 구현한다. **모델은 학년 무관하게 단 하나다** — 하나로 학습하고 추론 시 마스킹만 바꾼다.

**layout** — 심볼 쌍의 기하 특징(bbox 중첩, 정규화 중심 오프셋, 크기비, 작성 순서) ~20차원 → 2층 MLP → 관계 7클래스 `{Right, Sup, Sub, Above, Below, Inside, None}`. 파라미터 1만 미만.
관계 그래프에서 **Edmonds 최대신장트리**로 구조 트리를 뽑되, 단일 트리로 확정하지 말고 상위 후보를 grammar 단계로 넘긴다.

**grammar** — 순수 TS, ML 아님. 학년별 토큰 bigram/trigram + **답안 템플릿 prior**. 정확도 대비 비용이 가장 좋은 구간이다.

**emit** — LaTeX는 **정규형**으로 낸다 (`\frac{1}{2}`, `\times`, 불필요한 중괄호 제거). 내부 AST는 유지하되 **공개 API로 노출하지 않는다** — 채점이 범위 밖이므로 필요해지기 전에는 만들지 않는다 (YAGNI).

## 3. 좁은 도메인을 이기는 수단

MyScript는 모든 수식을 커버해야 하지만 우리는 아니다. 그 차이를 전부 정확도로 환전한다.

### 학년별 심볼 집합 (`src/vocab/`)

| 학년군       | 추가되는 것                                                                                                                          |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `elementary` | `0-9` · `+ - × ÷ =` · `< >` · `. ,` · `( )` · 분수 바 · `%` · 빈칸 `□` · 측정 단위                                                   |
| `middle`     | 변수 · `√` · 지수/아래첨자 · `≤ ≥ ≠` · `π` · `±` · `sin cos tan` · 기하 기호 · 절댓값 · 좌표쌍                                       |
| `high`       | 공통수학 기호 + 과목별 profile(`algebra`, `calculus`, `probability`, `geometry`)의 집합·행렬·로그·수열·극한·미분·적분·확률·벡터 기호 |

누적식이다 (`high`는 셋 다 포함). 전체 ~150클래스. 새 심볼 추가는 `src/vocab/`의 한 파일만 고치면 되도록 유지한다.

### 혼동쌍 (오답의 대부분이 여기서 나온다)

`x / × / χ` · `1 / l / | / /` · `0 / O / o / °` · `2 / z` · `5 / S` · `9 / q / g` · `6 / b` · `- / _ / 분수바` · `. / , / ·` · `( / C` · `t / +` · `∑ / Σ / E`

학년 게이팅과 문법 문맥으로 해소한다. 예: `elementary`에서 `x`자 모양은 **항상 `×`**다. 분류기를 더 키우지 말고 문맥을 먼저 써라. 이 클래스들은 수집 샘플 수를 3배 이상 확보한다(6장). 새 혼동쌍을 발견하면 골든셋에 케이스를 추가하고 이 표를 갱신한다.

### 답안 타입 힌트 — 우리의 진짜 차별점

답안은 문장이 아니라 **값**이다. 대부분 이 템플릿 중 하나다:
정수 · 소수 · 분수/대분수 · `x = 값` · `a ± b√c` · 좌표 `(x, y)` · 집합 · 구간 · 단위 붙은 수.

이 prior를 빔 재랭킹에 넣는다. 나아가 **호출자가 기대 답 타입을 넘길 수 있게 API에 노출한다** ("분수로 답하시오" 문제면 `expect: "fraction"`). MyScript가 구조적으로 못 하는 부분이니 우선순위를 높게 잡아라. (채점 기능이 아니라 인식 정확도 수단이다.)

## 4. 공개 API

```ts
const recognizer = await createRecognizer({
  context: {
    curriculum: "2022",
    schoolLevel: "elementary" | "middle" | "high",
    grade: number,
    subject: string,
    unit: string,
    answerType: "number" | "fraction" | "expression" | "equation" | "inequality" | "coordinate" | "set" | "interval" | "matrix",
    allowedVariables?: string[],
    allowedSymbols?: string[],
  },
  modelUrl?: string,
});

recognizer.addStroke(stroke);      // 증분. 내부적으로 영향받은 심볼만 재계산
recognizer.removeStroke(id);       // 지우개/제스처도 반드시 증분 경로를 탄다
const result = recognizer.recognize();
// → { latex, confidence, alternatives[], symbols[] }
recognizer.reset();
```

- `symbols[]`는 심볼↔획 매핑. UI에서 오인식 부분을 하이라이트하거나 지우게 하려면 필요하다.
- **MathML·의미 트리는 반환하지 않는다.** 채점이 범위 밖이므로 공개 표면에 넣지 않는다. 내부 AST는 emit 단계가 쓰지만 밖으로 새지 않게 한다.

규칙:

- **추론은 전부 Web Worker 안에서.** 메인 스레드는 캡처와 렌더만 한다. P580에서는 이게 체감 속도를 결정한다.
- 모든 중간 표현(`Stroke[]`, `SymbolCandidate[]`, `StructureTree`)은 디버그용 JSON으로 변환 가능해야 한다. hot path에서는 TypedArray를 허용한다.
- 단계 간 캐시와 증분 상태는 명시적 입력·출력으로 전달한다. 숨은 전역 상태는 금지한다.
- 캔버스 렌더링 유틸은 별도 옵셔널 엔트리로 분리한다. 코어는 DOM 의존 최소.

## 5. 성능 예산

P580/P610 실기기 기준이다. MVP는 feasibility gate, production은 출시 gate다.

| 항목                                 |    MVP gate | Production gate |
| ------------------------------------ | ----------: | --------------: |
| 획 추가 → 후보 갱신                  | p95 ≤ 100ms |      p95 ≤ 50ms |
| 펜 뗀 후 → 최종 LaTeX                | p95 ≤ 300ms |     p95 ≤ 150ms |
| 모델 가중치 (**학년 무관 공용 1개**) |      ≤ 10MB |           ≤ 5MB |
| 피크 힙                              |     ≤ 150MB |         ≤ 150MB |

콜드 스타트와 JS+WASM 크기는 첫 PoC에서 기록한 뒤 production budget을 확정한다. ORT Web 1.30 기본 WASM은 현재 빌드에서 약 14.2MB(약 3.7MB gzip)였으므로 기존 `gzip ≤1.5MB`를 검증 없이 강제하지 않는다.

**측정 규칙: 실측 없는 성능 주장 금지.** `bench/`에 잉크 픽스처를 고정하고 `vp run bench`로 재현 가능하게 유지한다. 실기기가 없으면 Chrome DevTools CPU 6× 스로틀을 쓰되, 결과에 "대리 측정"이라고 반드시 명시한다.

### 추론 런타임 선택 순서 — 생태계 먼저

1. **P0에서는 ONNX Runtime Web WASM으로 빨리 숫자를 만든다.** 런타임 교체와 모델 구조 변경을 동시에 실험하지 않는다.
2. **production 후보 단계에서 기성 런타임을 실기기에서 비교한다.** ONNX Runtime Web(필요 연산자만 넣는 축소 빌드 포함)과 LiteRT.js를 P580/P610에서 직접 재고, 지연·번들 크기·콜드 스타트를 표로 남긴다.
   - LiteRT.js는 비교적 신생이다. 전역 지침의 "1.x 미도달이거나 활발히 깨지는 라이브러리는 피한다" 기준에 걸리는지 먼저 확인할 것.
3. **둘 다 예산을 못 맞출 때만** 손으로 짠 Rust→WASM 커널. SIMD128 사용, `wasm-bindgen` 없이 최소 export 표면으로. 자체 커널로 가는 결정은 사람과 합의 후.

기타:

- **WASM 스레드는 최후 수단.** `SharedArrayBuffer`는 COOP/COEP 헤더를 요구하고, 임베드되는 라이브러리에는 현실적으로 독이다.
- 모델 가중치는 int8 양자화 + **별도 바이너리 파일**. base64 인라인 금지 (33% 부풀고 파싱 비용까지 든다).
- 브라우저 빌드 타깃은 ES2020. 루트 `tsconfig.json`의 `esnext`는 노드 툴링용이므로, 배포 번들 타깃은 따로 지정한다.
- **기기 능력을 가정하지 말고 검증하라.** P580의 Android/Chrome 버전, WASM SIMD 지원 여부, `pointerrawupdate` 지원 여부는 실기기에서 확인하고 결과를 이 문서에 기록한다. WebGPU는 없다고 가정한다.

## 6. 데이터 — 이 프로젝트 최대의 리스크

상용 서비스이므로 **연구용·비상업 라이선스 데이터셋은 학습에 쓸 수 없다.** 이 제약이 아키텍처와 로드맵을 모두 결정한다.

### Production 사용 금지 (학습·파인튜닝·증류 전부)

| 데이터셋                       | 라이선스            | 판정                                           |
| ------------------------------ | ------------------- | ---------------------------------------------- |
| **MathWriting** (Google, 2024) | **CC BY-NC-SA 4.0** | ❌ 상용 학습 불가. 법무 승인된 격리 PoC만 허용 |
| **CROHME** (2011–2023)         | 연구용              | ❌ 상용 학습 불가                              |

MathWriting은 가장 먼저 손이 가는 데이터셋이라(사람 손글씨 23만 InkML) 반드시 짚고 넘어간다. **공식 readme에 "the content of this archive has been placed under the CC BY-NC-SA licence"라고 명시돼 있다.** NC는 비상업 조건, SA는 파생물 동일조건 공유다. 모델을 오픈소스로 공개해도 NC 위반은 해소되지 않는다.

- 출처: <https://github.com/google-research/google-research/blob/master/mathwriting/archive_readme.md>
- 예외 가능성 하나: MathWriting의 **LaTeX 문자열 코퍼스** 중 Wikipedia 유래분은 CC BY-SA(상용 가능)로 표기돼 있다. 잉크는 못 써도 문자열은 쓸 여지가 있으나, SA의 파생물 조건 때문에 **법무 확인 전에는 쓰지 마라.**
- **병행 추진 가치 있음:** Google에 MathWriting 상용 라이선스를 문의하는 것. 성사되면 23만 수식이 열려 프로젝트 리스크가 급감한다. 비용 대비 기대값이 높으니 일찍 시도할 것.

### 검증 필요

- **Detexify** 심볼 스트로크 데이터 — 라이선스 **미확인**. 확인 전에는 쓰지 마라. 상용 가능으로 확인되면 분류기 사전학습에 유용하다.

### 실제로 쓸 데이터

**1. 기존 MyScript 앱의 opt-in 자체 수집 — PoC 다음 크리티컬 패스다.**

MyScript에 전달하기 전 원본 `x/y/time/stroke-boundary`와 사용자가 확인·수정한 최종 LaTeX를 수집한다. 인식은 오프라인으로 유지하고 업로드는 별도 opt-in 후 온라인일 때 호스트 앱이 담당한다. MyScript 출력만을 정답 라벨로 사용하지 않는다.

- 체결한 MyScript 상용 계약이 경쟁 모델 학습을 제한하지 않는지 서면으로 확인한다.
- 개인정보처리방침에 모델 학습 목적·항목·보유기간을 명시하고, 만 14세 미만은 법정대리인 동의를 확인한다.
- 계약·동의 검토를 통과하지 않은 과거 데이터는 production 학습셋에 넣지 않는다.
- modular baseline용 낱개 심볼 수집과 joint model용 실제 수식 잉크를 모두 보존한다.

- 심볼 잉크: **150클래스 × 300샘플 ≈ 45,000개.** 혼동쌍 클래스(3장)는 1,000개 이상.
- **필기자 다양성이 샘플 수보다 중요하다.** 한 사람이 1,000개 쓰는 것보다 300명이 1개씩 쓰는 게 낫다. 최소 200명 이상, 학년군별로 고르게.
- 한국 학생은 `7` `4` `1` `×` `√`를 쓰는 습관이 다르다. 해외 데이터셋이 있어도 이건 자체 수집이 필요했다.
- 수집 앱은 **M0 산출물**이다. "M1 이후"가 아니다.

**2. 합성 수식 — 구조 학습의 주력.**

자체 작성한 K-12 답안 LaTeX 코퍼스(교과서·기출 기반, 우리가 저작권 보유)에 수집한 심볼 잉크를 무작위 샘플·워프·배치해서 수식 잉크를 생성한다. layout 단계는 2D 배치 정답 라벨이 필요한데 실제 데이터로는 비싸고 **합성은 정답을 공짜로 안다.**

**3. 실제 수식 잉크 — 평가 전용, 소량.**

합성으로만 평가하면 거짓말을 한다. 실제 학생이 쓴 수식이 필요하지만 **평가셋은 학습셋보다 훨씬 작아도 된다** (7장 규모 참조). 학년군당 약 2,500개.

학습 시 랜덤 시드를 고정하고 데이터셋 버전·라이선스를 산출물 메타데이터에 기록한다.

학습 코드는 `training/` (Python). **배포 대상이 아니며 런타임 코드와 절대 섞지 않는다.**

## 7. 평가

**주 지표는 표현식 단위 정확도(expression-level exact match)** — LaTeX 정규화 후 완전 일치. 심볼 정확도는 보조 지표일 뿐이다. 한 심볼 틀리면 답은 오답이다.

부지표: 세그멘테이션 정확도 · 관계 정확도(structure F1) · top-3 정확도 · 지연 p50/p95 · 증분 출력 안정성.

### 평가셋은 두 개다 — 섞지 마라

|               | 크기               | 용도                                        | 방법                                              |
| ------------- | ------------------ | ------------------------------------------- | ------------------------------------------------- |
| **인증셋**    | 학년군당 **2,000** | "우리가 목표 정확도를 달성했다"를 주장할 때 | 독립표본. n=2,000, p=0.95에서 95% CI ≈ **±1.0%p** |
| **CI 회귀셋** | 학년군당 **500**   | 커밋 단위로 "뭘 깨뜨렸나" 확인              | 같은 항목 대응표본. **McNemar 검정**으로 비교     |

이 구분이 중요한 이유: 500개로 절대 정확도를 인증하려 하면 CI가 ±1.9%p라 95%와 96%를 구분 못 한다. 반대로 회귀 테스트는 같은 항목을 반복 측정하는 대응비교라 대부분 항목이 안 바뀌므로, 독립표본 CI가 시사하는 것보다 훨씬 민감하다. **500개는 회귀에 충분하고 인증에 부족하다.**

- ±0.5%p로 인증하려면 학년군당 ~7,300개가 필요하다. 그 정밀도가 정말 필요한지 먼저 따져라.
- **0.1% 수준 희귀 오인식은 어떤 오프라인 평가셋으로도 못 잡는다.** 프로덕션 피드백 수집(사용자 수정 로그)으로만 관측 가능하니, 평가셋을 키워서 해결하려 하지 마라.

목표: `elementary` ≥97% / `middle` ≥95% / `high` ≥93%, top-3 ≥99%. 학년군별로 **따로** 측정하고 보고한다.

인터랙티브 fast path의 end-to-end 지연 목표는 P580/P610에서 p50 200ms 이하다. 실험용 다중 모드·beam 비교는 이 목표에서 제외하고 명시적 benchmark 경로로만 실행한다.

새 오답을 발견하면 고치기 전에 먼저 회귀셋에 케이스를 추가한다.

## 8. 로드맵 — 깊이가 아니라 범위를 줄인다

각 마일스톤은 **동작하는 end-to-end happy path** 하나를 낸다. 다음으로 넘어가기 전에 이전 것이 실기기에서 돌아야 한다.

- **P0 (현재)** 연구 전용 Hand-to-TeX ONNX와 MathWriting 대표 500개로 `open → level → schema → problem` 제약 효과를 측정한다. batch report와 최소 캔버스를 만들고 P580/P610에서 ORT WASM을 실측한다. MyScript 비교·production 정확도 주장은 하지 않는다.
- **P1** P0 결과를 검토한다. 유망할 때만 MyScript 계약·개인정보 동의 gate를 통과하고 기존 앱의 opt-in 수집을 시작한다.
- **P2** 자체 데이터로 modular baseline과 3–10M급 compact online joint model을 비교하고 최종 아키텍처를 확정한다.
- **P3** 동일한 자체 골든셋에서 MyScript와 정확도·지연·수정률을 비교한다.
- **M0** 잉크 캡처 + 렌더 + InkML 저장/재생 **+ 심볼 수집 앱**. ML 없음. → _캔버스에 쓰면 저장·재생되고, 수집 클라이언트를 운영할 수 있다._
- **M1** 단일 심볼 인식, `0-9 + - × ÷ =`만. 학습 없이 템플릿 매칭/DTW k-NN으로. → _`3`을 쓰면 `3`이 나온다._
- **M2** 한 줄 수식. 관계는 `Right`만. → _`12+34=46`._
- **M3** 2D 구조: 분수, 지수, 근호.
- **M4** 학년 게이팅 + 문법 재랭킹 + 답안 타입 힌트. **+ seq2seq 비교 실험 착수** (2장).
- **M5** P580 실측 → 런타임 선택(5장) + 아키텍처 확정(2장 가설 해소).
- **M6** 증분 인식(획 단위 캐시) + 편집 제스처(그어서 지우기, 덧쓰기).

**데이터 수집은 P1의 계약·개인정보 gate를 통과한 뒤 모든 마일스톤과 병행한다.** 수집량이 M3 이후의 진도를 직접 제한하므로, 코드보다 먼저 막히는 쪽은 대체로 데이터다.

지금 어느 마일스톤인지 모르겠으면 코드를 짜기 전에 물어봐라.

## 9. 이 레포의 규칙

- **데이터셋·사전학습 가중치는 라이선스 확인 전에 쓰지 마라.** NC·연구용 자산은 법무 승인과 명시적 플래그가 있는 `prototype/` 격리 PoC에서만 허용하고 production 모델 계보에는 절대 합치지 않는다.
- 런타임 코드에서 **네트워크 호출 금지**. `fetch`는 로컬 모델 로딩에만.
- 새 런타임 의존성 추가는 **사람과 합의 후**. 의존성 0이 아니라 P580/P610 실측 지연·크기·유지보수 비용의 합을 최소화한다.
- **가설을 사실처럼 쓰지 마라.** 근거가 없으면 `[가설]`로 표기하고 판단 기준을 함께 적는다. 측정으로 해소되면 문서를 갱신한다.
- 단계 하나를 건드리면 그 단계의 픽스처 테스트를 같이 갱신한다. 회귀셋 점수가 떨어지면 원인을 찾기 전에는 머지하지 않는다.
- `vp check`와 `vp test`는 통과해야 한다. 훅/테스트 실패를 `--no-verify`로 우회하지 마라.
- 정확도 개선 주장은 평가셋 숫자(이전/이후)와 **어느 평가셋인지**를 함께 보고한다. 체감이나 예시 몇 개는 근거가 아니다.
- 성능 개선 주장은 실측 기기와 조건을 함께 보고한다.
- 사용자가 명시적으로 배포하지 말라고 지시하지 않은 한, 작업 완료 후 GitHub Pages 배포까지 수행하고 배포 성공 여부를 확인한다.
- `AGENTS.md` / `GEMINI.md`는 이 파일로의 심볼릭 링크다. **이 파일만 편집한다.**
