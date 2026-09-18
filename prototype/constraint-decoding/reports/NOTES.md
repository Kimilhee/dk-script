# Constraint decoding PoC verdict

## 2026-09-18

- Question: How much do 2022 curriculum, answer-schema, and problem-specific constraints reduce exact-match error with the recognizer held constant?
- Result: 26개 탐색 표본 exact는 open 53.8%, level/schema 57.7%, problem 73.1%였다. P580의 4모드 beam decode는 짧은 입력에도 약 1분이 걸렸고 greedy는 정확도 손실이 컸다.
- Decision: Hand-to-TeX와 현재 자기회귀 decoder를 production 후보에서 제외한다.
- Keep: 검증된 grammar/profile 로직, 결과 문서, 사용자 확정 InkML 내보내기.
- Next question: 작은 비자기회귀 모델이 P580에서 200ms 목표를 만족할 수 있는가?
- Delete later: research-only weights, MathWriting data, 기존 인식 canvas.
