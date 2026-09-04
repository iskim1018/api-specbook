# API Specbook

OpenAPI 3.x(Swagger) YAML/JSON을 다루는 두 가지 도구를 담는다.

1. **API Specbook** — 비개발자도 쓰는 데스크톱 앱(Windows/macOS, Tauri). 좌측 폴더 트리 · 중앙 실시간 에디터 · 우측 뷰어(공식 Swagger UI / 표 중심 HTML 명세서 탭 전환).
2. **oas2html** (CLI) — 스펙을 **표 중심의 단일 HTML 명세서**로 변환. Swagger UI / Editor 를 읽기 어려워하는 독자(기획, 연동 담당, 외부 기관)를 위한 "읽는 문서"이며, "호출해 보는 도구"(Try it out)는 의도적으로 제외한다.

두 도구는 같은 변환 엔진(`core/`)을 공유한다.

## 데스크톱 앱 (API Specbook)

```bash
npm install
npm run app:dev      # 개발: Vite dev server + Tauri 창 (핫리로드)
npm run app:build    # 배포용 번들 생성 (.app / .dmg / .msi 등)
npm run dev          # 프론트엔드만 브라우저에서 (Tauri 없이 UI 확인)
```

- 파일/폴더 열기, 드래그앤드롭, 저장, HTML 내보내기 지원.
- 편집하는 동안 우측 미리보기가 실시간 갱신되고, 문법 오류는 에디터에 인라인 표시된다.

## CLI (oas2html)

```bash
npm install
node core/cli.mjs sample/*.y*ml -o dist/        # 여러 파일 → 디렉터리
node core/cli.mjs spec.yaml -o spec.html         # 단일 파일
npm run build:samples                            # sample/ 전체 → dist/
```

출력은 CSS/JS 가 모두 인라인된 HTML 파일 하나다. 서버 없이 더블클릭으로 열리고, 메일 첨부와 인쇄(PDF 저장)가 된다.

## 문서 구성

- 개요: 제목, 버전, 서버 목록(변수 포함), `info.description` (Markdown 표·코드블록 렌더링)
- 인증: `components.securitySchemes`
- 태그별 섹션: 태그 내 API 목록 표 → 각 API 상세
- API 상세
  - operationId, 요약, 메서드 + 경로(복사 버튼), 설명(Markdown)
  - `x-dsp-note` → "유의사항" 콜아웃, `x-dsp-rspns-paths` → "수신 경로" 표, 그 외 `x-*` 는 접힌 "확장 필드"
  - Path / Query / Header / Cookie 파라미터 표
  - 요청 본문 표 + 요청 예시 JSON
  - 상태코드별 응답: 2xx 는 펼침, 4xx/5xx 는 접힘. 스키마 표 + 예시. `examples` 가 여러 건이고 값이 평면 객체면 한 표로 합침
- 좌측 목차: 태그별 그룹, 검색 필터, 스크롤 위치 강조. 모바일에서는 햄버거 버튼
- 인쇄: 목차 숨김, 접힌 항목 모두 펼침

## 스키마 표 규칙

| 열 | 내용 |
|---|---|
| 항목 | 필드명. 깊이만큼 들여쓰기 + 트리 선. 부모 행의 ▾ 로 하위 접기 |
| 타입 | `string`, `integer`, `object`, `array<object>`, `string (date)` 등. `nullable` 표시 |
| 필수 | 부모 스키마의 `required` 기준 |
| 제약 | maxLength, pattern, min/max, enum, default, format 등 |
| 설명 | `description` (Markdown, 줄바꿈 보존) |
| 예시 | `example` |

- 배열의 항목이 객체면 `items` 단계를 생략하고 자식 필드를 배열 바로 아래에 붙인다.
- `$ref` 는 모두 인라인으로 풀고 스키마 이름은 "스키마: ErrorResponse" 로 표기한다.
- `allOf` 는 병합, `oneOf`/`anyOf` 는 "다음 중 하나" 타입 아래 `옵션 N` 행으로 표현한다.
- 순환 참조는 한 단계에서 끊고 "(순환 참조: 이름)" 으로 표기한다.

## 제한

- OpenAPI 3.x 만 지원. Swagger 2.0 은 변환 후 사용.
- 외부 파일 `$ref` 미지원 (`#/components/...` 만).
- `discriminator` 는 특별 처리하지 않는다 (oneOf 로만 표현).
- 첫 번째 media type 만 표로 렌더링하고 나머지는 이름만 표기.

## 구조

```
core/           공유 변환 엔진 (CLI·앱 공용)
  cli.mjs         CLI (입력 파싱, 출력 경로)
  model.mjs       OpenAPI → 렌더링 모델 ($ref 해소, allOf/oneOf, 스키마 평탄화, 예시 생성)
  render.mjs      모델 → HTML (템플릿, 인라인 CSS/JS)
src/            데스크톱 앱 프론트엔드 (Vite)
  main.js         앱 셸·상태·툴바·live 미리보기 배선
  editor.js       CodeMirror 에디터 (YAML/JSON + 구문 검사)
  viewer.js       우측 뷰어 (Swagger UI / 문서 HTML 탭)
  tree.js         폴더 트리
  fileio.js       파일 I/O (Tauri 다이얼로그/FS + 브라우저 폴백)
  parse.js        스펙 파싱 + 오류 위치
src-tauri/      Tauri(Rust) 셸 — 창, dialog/fs 플러그인, 권한
index.html      Vite 진입점
sample/         입력 샘플
dist/           CLI 생성 결과 (gitignore 대상)
dist-app/       앱 프론트엔드 빌드 산출 (gitignore 대상)
```
