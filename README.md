# dk-script

온디바이스 수식 필기 인식의 교육과정 제약 효과를 검증하는 프로젝트입니다.

현재 구현은 production 라이브러리가 아니라 폐기 가능한 연구용 PoC입니다. 질문은 하나입니다.

> 같은 온라인 필기 모델에서 학교급·답안 형식·문제별 제약을 강화하면 exact match error가 얼마나 줄어드는가?

자세한 실행법과 라이선스 경계는 [`prototype/constraint-decoding/README.md`](prototype/constraint-decoding/README.md)를 참고하세요.

## Development

- Install dependencies:

```bash
vp install
```

- Prepare research-only model assets after legal approval:

```bash
vp run poc:prepare -- --accept-research-license
```

- Run the interactive canvas:

```bash
vp run poc
```

- Deploy the PoC to GitHub Pages: push `main` after enabling **Settings → Pages → GitHub Actions**. The workflow uses the repository name as the Vite base path and loads research model files directly from their public upstream host.

- Run the unit tests:

```bash
vp test
```

- Build the library:

```bash
vp pack
```
