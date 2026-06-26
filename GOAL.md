# /goal

작업 경로는 `/Users/yprite/repos/klogcat-bugfix` 이다.
현재 브랜치 `work/bugfix` 에서 Klogcat의 버그를 Rubber Duck Debugging 방식으로 체계적으로 발견하고, 테스트와 함께 수정한다.

Klogcat은 Tauri + React 기반 Kubernetes pod log tailer이다.
주요 관심사는 로그 스트림 시작/중지/재연결, Kubernetes context/namespace/pod/container 선택, raw log 파싱, 실패 요청 탐색, 검색/필터링, 설정 저장, Tauri command fallback, 대용량 로그 렌더링이다.

## 핵심 원칙

- 바로 수정하지 않는다. 먼저 사용자가 화면에서 무엇을 하고 시스템이 내부에서 어떻게 처리하는지 말로 따라간다.
- 화면에서 재현 가능한 문제와 코드 기반 문제를 모두 분석한다.
- 발견한 버그는 원인, 영향 범위, 재현 방법, 수정 방향을 기록한다.
- 모든 버그 수정에는 반드시 테스트를 추가하거나 기존 테스트를 보강한다.
- 테스트 없는 수정은 완료로 간주하지 않는다.
- 기존 구조를 보존하고, 버그 단위로 작게 고친다.
- 추측하지 말고 코드, 테스트, 실행 결과를 근거로 판단한다.

## 진행 방식

### 1. 프로젝트 구조 파악

- `README.md`, `package.json`, Vite/Vitest 설정, `src/App.tsx`, `src/components`, `src/stores`, `src/utils`, `src/commands`, `src-tauri`를 읽는다.
- 기존 테스트 구조를 확인한다:
  - `src/__tests__/*.test.ts` / `*.test.tsx`
  - `src/__tests__/scenarios/*.scenario.test.*`
  - `e2e/productQuality.e2e.test.tsx`
- 앱의 주요 사용자 플로우를 정리한다:
  - 앱 실행
  - Kubernetes context/namespace/pod/container 선택
  - 로그 source/type 선택
  - Start / Stop / Reset
  - 로그 수신, stderr, exit, reconnect, fallback pod 처리
  - raw log 보기
  - ACCESS / ERROR / INFO / 기타 로그 파싱
  - 실패 요청 탐색
  - grep/search/filter/highlight
  - 설정 modal 저장/초기화

### 2. Rubber Duck Debugging

각 주요 기능마다 아래 형식으로 먼저 설명한다:

- 사용자가 화면에서 하는 일:
- 관련 UI 컴포넌트:
- 관련 store/state:
- 관련 command/API:
- 관련 parser/util:
- 정상 흐름:
- 실패 흐름:
- 의심 지점:
- 근거 파일:

설명 중 다음을 찾는다:

- 상태 변화가 애매한 부분
- null/undefined/빈 배열 처리 누락
- 비동기 이벤트 순서 문제
- Tauri command 실패 또는 fallback 누락
- stale stream / stale pod / stale selection 문제
- 로그 파싱 실패가 UI를 깨는 문제
- 검색/필터/정렬/가상 리스트 상태 꼬임
- 에러, 빈 상태, 로딩 상태가 사용자에게 불명확한 문제

### 3. 실제 화면 기반 점검

가능하면 앱을 실행해서 주요 화면을 확인한다.

우선 실행 후보:

```bash
npm install
npm run dev
npm run klogcat:dev
npm start -- --force-build --debug
```

실제 Kubernetes 접근이 불가능하면 그 사실을 기록하고, 기존 fixture/test/mock 기반으로 대체 검증한다.

화면에서 확인할 항목:

- Start 버튼이 설정 누락, 잘못된 pod/container, 파일 경로 오류를 명확히 보여주는가
- Stop/Reset이 stream 상태별로 올바르게 동작하는가
- Context/Namespace/Pod/Container 선택 변경 시 stale selection이 남지 않는가
- raw log와 parsed log가 동시에 필요한 정보를 잃지 않는가
- 실패 요청 필터가 status code, exception, latency, trId, spanId 기준으로 탐색 가능한가
- 검색/grep/highlight가 빈 결과, 긴 문자열, 특수문자, 대량 로그에서 깨지지 않는가
- stderr/exit/reconnect/fallback pod 상태가 사용자에게 보이는가

### 4. 코드 기반 집중 분석

특히 아래 파일군을 우선 확인한다:

- `src/App.tsx`
  - `subscribeLogEvents`
  - `handleLogExit`
  - `retryWithFallbackPod`
  - `reconnectStream`
- `src/stores/logStore.ts`
  - stream 상태
  - `activeStreamMetas`
  - `stderrByStream`
  - `reconnectEnabled`
  - `appendLine` / `appendLines`
  - `markRunning` / `markError` / `markStopped`
- `src/stores/kubeStore.ts`
  - context/namespace/pod/container 선택
  - fallback pod
  - `refreshPodsForSelections`
- `src/components`
  - `AppShell`
  - `LogViewer`
  - `LogRow`
  - `FailedRequestsView`
  - `LogToolbar`
  - `GrepBar`
  - `SettingsModal`
  - `ErrorBanner`
  - `ProgressFeedback`
- `src/utils`
  - `parseLogLine`
  - `parseAccessLog`
  - `parseErrorLog`
  - `parseInfoLog`
  - `logQuery`
  - `grep`
  - `ringBuffer`
  - `logPolicy`
  - `podFallback`
- `src/commands`
  - `tauriLogs`
  - `tauriLogEvents`
  - `tauriKube`
  - `tauriSettings`

로그 뷰어 특화 점검:

- raw log 파싱 실패 케이스
- ACCESS / ERROR / INFO / UNKNOWN `logType` 처리
- status code 누락/문자열/숫자 혼합
- exception 필드 누락
- latency 경계값
- trId/spanId 누락 또는 긴 값
- JSON 깨짐
- 필드 일부 누락
- 매우 긴 log message 렌더링
- 대용량 로그 append 시 ring buffer/virtual rows 문제
- 검색어 변경 후 선택/스크롤/필터 상태 꼬임
- 실패 요청만 보기와 일반 로그 보기 간 상태 공유 문제

### 5. 버그 리포트 작성

버그를 발견하면 수정 전에 `docs/bug-audit-rubber-duck.md` 또는 작업 메모에 아래 형식으로 기록한다:

- ID:
- 제목:
- 심각도: Critical / Major / Minor
- 발견 위치:
- 사용자 흐름:
- 재현 절차:
- 기대 동작:
- 실제 동작:
- 원인 분석:
- 영향 범위:
- 수정 방향:
- 추가/수정할 테스트:
- 회귀 방지 포인트:

### 6. 테스트 작성

각 버그마다 최소 1개 이상의 테스트를 추가하거나 기존 테스트를 보강한다.

우선순위:

- parser/util 문제: `src/__tests__/*.test.ts`
- store/state 문제: `src/__tests__/*Store.test.ts`
- UI 컴포넌트 문제: `src/__tests__/*.test.tsx`
- 사용자 흐름 문제: `src/__tests__/scenarios/*.scenario.test.tsx`
- 실제 제품 흐름 문제: `e2e/productQuality.e2e.test.tsx`

테스트 이름은 버그 상황이 드러나게 작성한다.
예:

- `handles malformed access logs without dropping raw message`
- `keeps failed request filters stable after grep changes`
- `marks stream error when reconnect fallback cannot find running pod`
- `preserves raw log text for unknown log type`
- `does not hide long exception messages in failed requests view`

테스트가 불가능한 경우:

- 왜 자동 테스트가 어려운지 기록한다.
- 대체 검증 방법을 명시한다.
- 그래도 가능한 가장 가까운 단위/시나리오 테스트는 추가한다.

### 7. 수정

- 버그 단위로 작게 수정한다.
- 기존 의도를 훼손하지 않는다.
- raw log 표시 니즈를 유지한다.
- 실패 요청 탐색 기능을 약화시키지 않는다.
- Tauri/Rust 쪽 수정이 필요하면 `src-tauri` 테스트와 cargo 검증도 함께 수행한다.
- UI 변경은 사용자 관점에서 상태가 더 명확해지는 방향으로만 한다.

### 8. 검증

수정 후 관련 테스트를 먼저 실행하고, 가능하면 전체 검증을 실행한다.

기본 검증:

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

테스트 계층별 검증:

```bash
npm run test:unit
npm run test:scenario
npm run test:e2e
```

Tauri/Rust 변경이 있으면:

```bash
cd src-tauri && cargo fmt -- --check
cd src-tauri && cargo test
cd src-tauri && cargo check
```

검증 실패가 있으면:

- 실패 원인을 분석한다.
- 관련 수정 또는 테스트 수정을 진행한다.
- 다시 실행한 결과를 기록한다.

## 최종 결과물

1. 수정한 버그 목록
2. 각 버그의 원인과 수정 내용
3. 추가/수정한 테스트 목록
4. 실행한 검증 명령어와 결과
5. 실제 화면 확인 여부와 재현 절차
6. 남아 있는 리스크
7. 다음 개선 제안

## 완료 조건

- 발견한 각 버그에 테스트가 있다.
- 관련 테스트가 통과한다.
- 가능한 전체 검증이 통과한다.
- 통과하지 못한 검증은 명확한 이유와 남은 조치가 기록되어 있다.
- 최종 답변에는 변경 파일, 테스트, 검증 결과를 간결하게 요약한다.

## 주의

- 근거 없이 "아마도"라고 판단하지 않는다.
- 테스트 없는 수정은 완료로 말하지 않는다.
- 실제 Kubernetes 환경이 없어 검증하지 못한 부분은 명확히 구분한다.
- 코드 변경 전후의 의도를 기록한다.
- 기존 테스트와 제품 구조를 존중하고, 불필요한 리팩터링은 하지 않는다.
