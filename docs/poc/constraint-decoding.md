# Constraint decoding PoC

상태: 구현 완료, 연구 자산 다운로드와 P580/P610 실측 대기.

## 질문

모델과 입력을 고정하고 `open → level → schema → problem` 순서로 decoder 제약을 강화할 때 exact-match error가 얼마나 줄어드는가?

## 고정된 실험 조건

- Baseline: research-only Hand-to-TeX ONNX
- Corpus: MathWriting test에서 2022 K–12 profile로 매핑 가능한 대표 500개
- Runtime: Node CPU batch + Android Chrome ORT WASM
- Metrics: canonical exact match, top-3, token edit rate, invalid sequence rate, error reduction, p50/p95
- Target devices: Samsung SM-P580, SM-P610

## 결과

아직 실행하지 않았다. 법무 승인 후 `vp run poc:prepare -- --accept-research-license --full`과 `vp run poc:batch`를 실행하고, 두 실기기 결과를 함께 기록한다.

## 결정

결과 검토 전에는 production 아키텍처를 확정하지 않는다. 유망한 경우에만 기존 MyScript 앱의 opt-in 데이터 수집과 modular/joint model 비교로 이동한다.
