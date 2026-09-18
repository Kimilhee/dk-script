# Constraint decoding PoC

상태: Hand-to-TeX production 후보 탈락. 자체 데이터 수집과 비자기회귀 소형 모델 실험으로 이동.

## 질문

모델과 입력을 고정하고 `open → level → schema → problem` 순서로 decoder 제약을 강화할 때 exact-match error가 얼마나 줄어드는가?

## 고정된 실험 조건

- Baseline: research-only Hand-to-TeX ONNX
- Corpus: MathWriting test에서 2022 K–12 profile로 매핑 가능한 대표 500개
- Runtime: Node CPU batch + Android Chrome ORT WASM
- Metrics: canonical exact match, top-3, token edit rate, invalid sequence rate, error reduction, p50/p95
- Target devices: Samsung SM-P580, SM-P610

## 결과

공식 excerpt 100개 중 현재 curriculum/profile에 매핑 가능한 26개를 탐색적으로 측정했다.

| Mode    | Exact | Top-3 |
| ------- | ----: | ----: |
| open    | 53.8% | 76.9% |
| level   | 57.7% | 73.1% |
| schema  | 57.7% | 73.1% |
| problem | 73.1% | 80.8% |

표본이 작고 K–12 대표성이 없으므로 production 정확도 추정치는 아니다. 하지만 P580에서 `x+1` 같은 짧은 입력의 4모드 beam decode가 약 1분 걸렸고, greedy fast path도 사용자가 수용할 정확도에 도달하지 못했다.

## 결정

교육과정 제약은 open 대비 오류를 줄였지만 목표 정확도 93–97%와 P580 200ms 목표를 동시에 만족시키지 못했다. Hand-to-TeX와 현재 자기회귀 decoder는 production 후보에서 제외한다.

다음 실험은 서버 업로드 없이 사용자 확정 LaTeX와 원본 획을 InkML로 내보내는 수집 경로를 먼저 검증한다. 이후 작은 심볼 분류기 + 공간 parser 또는 단일 forward-pass 모델을 동일한 P580 지연 기준으로 비교한다.
