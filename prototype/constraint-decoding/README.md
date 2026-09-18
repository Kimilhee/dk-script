# Constraint decoding PoC

> PROTOTYPE — 이 코드는 production 인식기가 아니다. 질문에 답한 뒤 검증된 grammar 로직만 남기고 나머지는 삭제한다.

## 질문

같은 Hand-to-TeX online-stroke 모델과 같은 필기를 고정했을 때 다음 decoder 제약이 expression exact-match error를 얼마나 줄이는가?

1. `open`: upstream vocabulary
2. `level`: 2022 교육과정 초·중·고 token mask
3. `schema`: 학교급 + answer type + 최소 구조 문법
4. `problem`: schema + 문제별 허용 변수·기호

MyScript 비교와 production 모델 선택은 이 PoC의 범위 밖이다.

## 라이선스 경계

MathWriting은 CC BY-NC-SA 4.0이다. Hand-to-TeX 모델도 MathWriting 학습 계보이므로 둘 다 법무 승인을 받은 연구용 실험에서만 사용한다. 다운로드 자산은 Git에 포함되지 않으며 production 모델·데이터와 합치지 않는다.

```bash
vp install

# 모델 + 100개짜리 공식 excerpt. 명시적 승인은 필수다.
vp run poc:prepare -- --accept-research-license

# 계획한 500개 batch용 전체 archive(다운로드 약 3.1GB).
vp run poc:prepare -- --accept-research-license --full
```

## 실행

인터랙티브 캔버스:

```bash
vp run poc
```

펜을 뗀 뒤 250ms가 지나면 `problem` 모드를 greedy decode하는 fast path를 실행한다. `4모드 비교` 버튼만 세 개 beam으로 네 모드를 순차 실행하므로 P580/P610의 일반 입력에는 사용하지 않는다. 화면의 `전체 Nms`가 캡처부터 결과 수신까지의 end-to-end 지연이다. 목표는 P580에서 200ms 이하지만, 현재 공개 baseline으로 달성됐다고 간주하지 않는다.

네 결과 카드와 대안 후보는 KaTeX로 렌더링하며 원본 LaTeX는 요소의 `title`에 남긴다. 자체 모델용 표본은 사용자가 정답 LaTeX를 확인·수정한 뒤 `InkML 다운로드`로 기기에만 저장할 수 있다. 자동 업로드나 영속 저장은 없다.

## GitHub Pages

`main`에 push하면 `.github/workflows/pages.yml`이 정적 앱을 빌드하고 Pages에 배포한다. 저장소 이름으로 base path를 자동 구성하므로 `/dk-script/` 같은 project page에서도 동작한다.

Pages 빌드는 모델을 저장소나 배포 artifact에 복제하지 않는다. 브라우저가 공개된 원 배포처에서 약 18.5MB의 연구용 모델을 최초 한 번 받고 Service Worker에 캐시한다. 처음 `준비됨`이 표시될 때까지 온라인 상태를 유지해야 하며, 이후 새로고침하여 오프라인 동작을 확인한다.

GitHub 저장소의 **Settings → Pages → Source**는 `GitHub Actions`로 설정해야 한다.

500개 batch report:

```bash
vp run poc:batch
```

빠른 smoke run:

```bash
vp run poc:batch -- --limit 5
```

결과는 `reports/constraint-decoding.{json,md}`에 생성되며 의도적으로 Git에서 제외된다. 검토가 끝나면 결론만 `reports/NOTES.md`와 `docs/poc/constraint-decoding.md`에 옮긴다.

## 측정 주의사항

- 대표 500개는 탐색용 표본이다. production 정확도 주장의 근거가 아니다.
- MathWriting label을 heuristic으로 2022 school level과 answer type에 매핑한다. `problem` 모드의 허용 변수·기호도 정답 label에서 추론하므로 실제 문제 metadata가 아니라 효과의 상한을 보는 실험이다.
- baseline 모델은 공식 benchmark가 없고 FP32 model files가 약 18.5MB다.
- 현재 ORT Web build의 WASM은 약 14.2MB(약 3.7MB gzip)다. PoC 수치이지 production budget 충족 결과가 아니다.
- batch의 Node CPU 시간과 Android Chrome WASM 시간은 서로 다른 지표다.
