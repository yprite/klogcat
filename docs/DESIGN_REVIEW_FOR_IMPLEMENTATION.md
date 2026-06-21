# klogcat 설계문서 구현 관점 리뷰

> 리뷰 대상: `/Users/yprite/klogcat/docs/DESIGN.md`  
> 목적: 설계문서를 구현문서(`docs/plans/v0.1-implementation.md`)로 전환할 수 있는 수준까지 보완하기 위한 독립 리뷰

---

## 1. 종합 판단

현재 `docs/DESIGN.md`는 **제품 방향과 v0.1/v0.2 범위는 꽤 명확하지만, 바로 구현문서로 전환하기에는 아직 부족하다.**

잘 정리된 부분:

- `kubectl logs -f`가 아니라 `kubectl exec ... tail -F <file>` 기반이라는 제품 정체성
- APP / ACC / ERR source type과 JSON 내부 `logType` 분리
- JSON Lines best-effort parsing 정책
- raw grep 중심의 v0.1 검색 범위
- ring buffer, pause/resume, process lifecycle의 큰 방향
- v0.1/v0.2 scope 구분

구현계획 문서로 쓰려면 추가로 필요한 부분:

- v0.1에서 실제로 어떤 화면/상태/명령/API를 먼저 만들지에 대한 **구현 순서**
- Rust ↔ TypeScript 사이의 **Tauri command/event 계약**
- Kubernetes discovery 명령의 정확한 방식
- 설정 파일 저장 위치/형식/초기값 결정
- stream line chunking, stderr, process 종료, 재시작 정책의 세부 동작
- parser와 UI rendering의 acceptance criteria
- 테스트 전략과 fixture 정의
- v0.1에서 “단일 pod + 단일 log type”인지 “APP/ACC/ERR 중 하나만 동시에 tail”인지에 대한 명확한 구현 제약

판정:

```text
좋은 설계 초안이다.
하지만 구현문서로 전환하기 전 보완이 필요하다.
```

---

## 2. Must-fix issues

### 2.1 v0.1 실행 흐름이 구현 단위로 쪼개져 있지 않음

현재 v0.1 scope는 기능 목록 중심이다.

예:

- namespace 목록 조회
- pod 목록 조회
- APP/ACC/ERR 단일 선택
- stream
- parser
- grep
- ring buffer
- pause/resume

하지만 구현자는 다음 질문에 답하기 어렵다.

- 앱 시작 시 가장 먼저 호출하는 명령은 무엇인가?
- context는 어떻게 가져오는가?
- namespace 기본값은 어디서 결정하는가?
- pod 목록은 언제 refresh되는가?
- source type 변경 시 buffer는 clear되는가?
- pod 변경 시 grep 입력은 유지되는가?
- stream start button이 있는가, 선택 즉시 시작하는가?

권장 추가 문구:

```md
### v0.1 User Flow

1. 앱 시작 시 `kubectl config current-context`를 호출해 현재 context를 표시한다.
2. `kubectl get namespace -o json`으로 namespace 목록을 불러온다.
3. 사용자가 namespace를 선택하면 `kubectl get pods -n <namespace> -o json`으로 pod 목록을 불러온다.
4. 사용자가 pod와 source type(APP/ACC/ERR)을 선택한다.
5. 사용자가 Start를 누르면 기존 stream을 정리하고 새 tail stream을 시작한다.
6. source type, namespace, pod 변경 시 실행 중인 stream은 stop되고 buffer는 clear된다.
7. grep 입력은 stream 변경 시 유지한다. Clear 버튼은 buffer만 비운다.
```

---

### 2.2 Tauri command / event contract가 없음

현재 문서에는 아키텍처 방향은 있지만 실제 구현자가 사용할 Rust command와 frontend event payload가 없다.

필요한 계약:

- `getCurrentContext`
- `listNamespaces`
- `listPods`
- `startLogStream`
- `stopLogStream`
- `stopAllLogStreams`
- emitted event name
- stdout line payload
- stderr payload
- process exit payload
- stream id 생성 규칙
- error payload shape

권장 타입:

```ts
type StartLogStreamRequest = {
  streamId: string
  namespace: string
  pod: string
  container: string
  sourceType: SourceLogType
  filePath: string
  initialTailLines: number
}

type LogLineEvent = {
  streamId: string
  sourceType: SourceLogType
  namespace: string
  pod: string
  container: string
  filePath: string
  line: string
  receivedAt: number
}

type LogStreamStderrEvent = {
  streamId: string
  line: string
  receivedAt: number
}

type LogStreamErrorEvent = {
  streamId: string
  message: string
  details?: string
  stderr?: string
  exitCode?: number
}

type LogStreamExitEvent = {
  streamId: string
  exitCode?: number
  signal?: string
}
```

명령 목록:

```text
- getCurrentContext()
- listNamespaces()
- listPods(namespace)
- startLogStream(request)
- stopLogStream(streamId)
- stopAllLogStreams()
```

---

### 2.3 Kubernetes discovery 명령이 명확하지 않음

v0.1 필수 기능에 namespace/pod 목록 조회가 있지만, 어떤 kubectl 명령을 쓸지 없다.

권장 명령:

```text
current context:
kubectl config current-context

namespace list:
kubectl get namespaces -o json

pod list:
kubectl get pods -n <namespace> -o json

optional container list:
kubectl get pod <pod> -n <namespace> -o json
```

권장 v0.1 결정:

```text
v0.1은 Running pod를 우선 표시한다.
Non-running pod는 목록에 표시할 수 있으나 Start 시 경고 또는 error 처리한다.
container는 source mapping의 container 값을 사용하되, Start 전 pod spec의 containers[].name에 존재하는지 검증한다.
```

---

### 2.4 설정 저장 전략이 부족함

문서에는 config 예시는 있지만 실제 저장 위치/로드/기본값/수정 UI가 없다.

미결정 질문:

- 설정 파일은 어디에 저장되는가?
- Tauri app config dir을 쓰는가?
- 처음 실행 시 기본 config를 생성하는가?
- UI에서 source mapping을 수정할 수 있는가?
- v0.1에서 settings screen을 만들 것인가?
- config validation 실패 시 앱이 뜨는가, 막히는가?

권장 v0.1 결정:

```md
### Settings persistence

v0.1은 Tauri app config directory에 `settings.json`을 저장한다.
첫 실행 시 기본 설정을 생성한다.
v0.1에서는 source mapping을 간단한 Settings 화면에서 수정할 수 있다.
설정 저장 전 validation을 수행한다.
설정 로드 실패 시 기본값으로 fallback하고 UI에 warning을 표시한다.
```

---

### 2.5 stdout chunking / line splitting 정책이 없음

`kubectl exec tail` stdout은 항상 line 단위로 깔끔하게 이벤트로 오는 것이 아니다. Rust process stdout read는 chunk 단위일 수 있다.

권장 결정:

```text
v0.1은 `String::from_utf8_lossy`를 사용한다.
`\n` 기준으로 line을 분리하고, trailing `\r`은 제거한다.
완성되지 않은 partial line은 내부 buffer에 보관한다.
process 종료 시 partial line이 비어 있지 않으면 마지막 raw line으로 emit한다.
```

---

### 2.6 stderr 처리 정책이 너무 거칠다

현재 문서에는 “tail stderr는 stream error로 UI에 표시”라고 되어 있다.

하지만 `tail -F`는 stderr로 정상적인 상태 메시지를 출력할 수도 있다.

권장 정책:

```text
stderr line은 LogStreamStderrEvent로 전달한다.
v0.1에서는 stderr가 발생하면 stream status를 즉시 error로 바꾸지 않는다.
process가 non-zero로 종료된 경우 fatal error로 처리한다.
stderr 내용은 stream status area에 latest warning으로 표시한다.
단, kubectl spawn 실패, exec forbidden, command not found 등 process start 실패는 fatal error다.
```

---

### 2.7 stream identity / sourceId / streamId 생성 규칙이 없음

`ParsedLogLine`에는 `sourceId`, `streamId`가 있지만 생성 규칙이 없다.

권장:

```text
streamId는 stream 시작마다 새로 생성하는 UUID다.
frontend는 현재 activeStreamId와 다른 streamId의 event를 무시한다.
sourceId는 source identity를 표현하는 deterministic key다.
```

예:

```ts
const sourceId = `${namespace}/${pod}/${container}/${sourceType}/${filePath}`
```

---

### 2.8 stale event 처리 정책이 없음

namespace/pod/log type 변경 시 기존 process를 종료한다고 되어 있지만, 종료 중에 늦게 도착한 stdout event가 새 화면에 섞일 수 있다.

권장 정책:

```text
frontend store는 activeStreamId를 가진다.
모든 LogLineEvent는 streamId가 activeStreamId와 일치할 때만 반영한다.
Stop 이후 도착한 stale event는 discard한다.
```

---

### 2.9 parser acceptance criteria가 부족함

ACC/ERR/APP parser 필드 추출 목록은 좋지만, 구체적인 fallback 기준과 테스트 fixture가 없다.

권장 문구:

```text
display time priority:
1. epochTime이 valid number면 epochTime 사용
2. time이 valid ISO string이면 time 사용
3. receivedAt 사용

parseStatus:
- JSON.parse 성공: parsed
- JSON.parse 실패: raw
- JSON.parse 성공했지만 일부 필드 누락: parsed
```

필수 fixture:

```text
- valid ACC JSON
- valid ERR JSON
- valid APP JSON with message
- valid APP JSON with body string
- valid APP JSON with body object
- invalid JSON raw line
- ACC status string
- ERR errors empty array
```

---

### 2.10 v0.1의 APP/ACC/ERR 단일 선택을 명확히 해야 함

v0.1 필수 기능에는 `APP/ACC/ERR 단일 선택`이라고 되어 있지만, UI 예시는 multi-select처럼 보일 수 있다.

권장:

```text
v0.1에서는 APP/ACC/ERR 중 정확히 하나만 active source로 선택할 수 있다.
source type을 변경하면 기존 stream을 stop하고 buffer를 clear한 뒤 새 stream을 시작한다.
v0.2에서 APP/ACC/ERR multi-source tail을 지원한다.
```

UI도 v0.1에서는 segmented single select라고 명시하는 것이 좋다.

---

### 2.11 v0.1에서 Settings UI 포함 여부가 모순 가능성이 있음

v0.1 필수 기능에는 `log source mapping`이 들어가지만, UI 설계에는 설정 화면이 없다. 메인 UI에서 filePath/source mapping을 숨긴다고 되어 있기 때문에, 사용자가 mapping을 어떻게 바꾸는지 불명확하다.

권장 v0.1 최소안:

```text
v0.1은 Settings modal을 제공한다.
필드는 APP/ACC/ERR 각각의 container, filePath, initialTailLines, bufferLimit이다.
저장 시 validation한다.
```

---

### 2.12 구현 단계별 milestone이 없음

`docs/plans/v0.1-implementation.md`로 전환하려면 최소한 milestone이 있어야 한다.

필요 milestone:

1. 프로젝트 생성
2. kubectl discovery
3. 설정 로드/검증
4. process manager
5. event bridge
6. parser
7. store/ring buffer
8. UI
9. error handling
10. tests/fixtures
11. packaging smoke test

---

## 3. Should-fix issues

### 3.1 SourceLogType naming 불일치

문서 전체에서 `ACC`, `access`, `ERR`, `error`가 섞인다.

권장 명시:

```text
Internal sourceType values:
- app
- access
- error

Display labels:
- APP
- ACC
- ERR
```

---

### 3.2 ParsedLogLine.id 생성 규칙 필요

권장:

```text
id는 frontend log store에서 부여하는 monotonic number다.
앱 실행 중 전역 증가한다.
stream 재시작 시 reset하지 않는다.
```

---

### 3.3 grep semantics가 더 구체적이어야 함

권장 v0.1 결정:

```text
v0.1 grep은 plain substring match다.
기본은 case-insensitive다.
검색어 앞뒤 공백은 trim한다.
빈 검색어는 전체 표시한다.
```

---

### 3.4 highlight와 grep 대상 불일치 처리 보완

권장:

```text
raw-only match인 경우 v0.1에서는 highlight를 생략해도 된다.
대신 row는 표시된다.
```

---

### 3.5 Clear 동작 정의 필요

권장:

```text
Clear는 ring buffer와 visible list를 비운다.
tail process는 유지한다.
grep input은 유지한다.
line id counter는 reset하지 않는다.
```

---

### 3.6 Auto-scroll 동작 정의 필요

권장:

```text
auto-scroll on이면 새 visible log가 추가될 때 bottom으로 이동한다.
사용자가 수동으로 위로 스크롤하면 auto-scroll을 자동 off로 전환할 수 있다.
v0.1에서는 수동 toggle만 제공해도 된다.
```

---

### 3.7 Pause 동작과 ring buffer/visible list 분리 필요

권장:

```text
Pause 중에도 incoming logs는 ring buffer에 저장한다.
Pause 중 grep 입력 변경은 허용하되 화면 갱신은 Resume 시 적용한다.
```

---

### 3.8 pod restart 처리 범위 명확화

권장:

```text
v0.1은 stream disconnect 또는 pod restart 감지 시 자동 reconnect하지 않는다.
streamStatus = error로 표시하고 사용자가 Restart/Start를 다시 누른다.
```

---

### 3.9 validation 범위 필요

권장:

```text
initialTailLines는 integer이며 0 이상 100000 이하로 제한한다.
bufferLimit은 1,000 이상 200,000 이하 integer로 제한한다.
UI preset은 10,000 / 50,000 / 100,000을 제공한다.
```

---

### 3.10 v0.1 kube context 정책 명시 필요

권장:

```text
v0.1은 현재 kube context만 사용한다.
앱 내부에서 context 변경은 지원하지 않는다.
현재 context는 read-only로 표시한다.
```

---

### 3.11 테스트 전략 부재

권장 최소 테스트:

- TypeScript parser unit tests
- grep unit tests
- ring buffer unit tests
- Rust command argv construction test
- Rust line splitter test
- process manager cleanup test는 가능하면 integration 수준
- UI smoke test는 optional

---

## 4. 제안 구현 계획 개요

`docs/plans/v0.1-implementation.md`는 아래 구조가 적절하다.

```md
# klogcat v0.1 Implementation Plan

## 1. Goal

Single Pod Tail JSON Logcat:
- 현재 kube context 사용
- namespace/pod 선택
- APP/ACC/ERR 중 하나 선택
- kubectl exec tail -n <N> -F 기반 stream
- JSON Lines best-effort parser
- raw grep
- ring buffer
- pause/resume/clear
- process cleanup

## 2. Non-goals

- multi-pod
- multi-source simultaneous tail
- deployment selection
- regex/case-sensitive/invert
- kubectl logs -f
- structured query language

## 3. Milestone 0: Project bootstrap

Tasks:
- Tauri + React + TypeScript 프로젝트 생성
- Tailwind/Zustand/react-virtual 설치
- 기본 AppShell/TopBar layout 구성

Acceptance:
- `npm run dev` 또는 equivalent로 Tauri 앱 실행
- 빈 메인 화면 표시

## 4. Milestone 1: Settings model

Tasks:
- Settings type 정의
- default settings 정의
- settings load/save 구현
- source mapping validation 구현

Acceptance:
- 앱 시작 시 default settings 로드
- invalid filePath/container validation error 표시

## 5. Milestone 2: Kubernetes discovery

Tasks:
- current context 조회
- namespace list 조회
- pod list 조회
- pod container validation

Acceptance:
- 현재 context 표시
- namespace 선택 가능
- namespace 변경 시 pod 목록 갱신
- pod 선택 가능

## 6. Milestone 3: Rust process manager

Tasks:
- startLogStream command
- stopLogStream command
- stopAllLogStreams command
- argv 기반 kubectl exec tail 실행
- stdout line splitting
- stderr event emit
- process exit event emit
- app exit cleanup

Acceptance:
- 선택한 pod/source에 대해 tail process 시작
- stdout line event 수신
- stop 시 child process 종료
- shell string 사용 없음

## 7. Milestone 4: Frontend stream store

Tasks:
- activeStreamId 관리
- stale event discard
- stream status 관리
- ring buffer 구현
- clear 구현

Acceptance:
- stream event가 buffer에 쌓임
- source/pod 변경 시 이전 stream event가 섞이지 않음
- bufferLimit 초과 시 old lines drop

## 8. Milestone 5: Parser

Tasks:
- ParsedLogLine type 구현
- parseLogLine
- parseAccessLog
- parseErrorLog
- parseAppLog
- parseRawLog
- formatTime

Acceptance:
- ACC fixture summary 생성
- ERR fixture summary 생성
- APP fixture summary 생성
- invalid JSON raw fallback

## 9. Milestone 6: Search/filter

Tasks:
- plain substring grep
- empty query handling
- grep 변경 시 stream 재시작 방지
- filtered visible list 계산

Acceptance:
- raw line 기준 검색
- 기존 buffer 즉시 재필터링
- 신규 로그에도 검색 적용

## 10. Milestone 7: UI

Tasks:
- namespace selector
- pod selector
- source type single selector
- grep input
- toolbar: Start/Stop/Pause/Resume/Clear/Auto-scroll/Wrap
- virtualized log viewer
- log row renderer
- stream status/error area

Acceptance:
- v0.1 성공 기준 1~11 충족

## 11. Milestone 8: Error handling

Tasks:
- kubectl not found
- namespace/pod list failed
- exec forbidden
- container not found
- tail not found
- log file not found
- process disconnected
- JSON parse failure non-error 처리

Acceptance:
- fatal error와 non-fatal parse fallback 구분
- stderr/latest warning 표시
- process exit 시 status update

## 12. Milestone 9: Tests and fixtures

Tasks:
- parser fixtures
- grep tests
- ring buffer tests
- line splitter tests
- argv construction tests

Acceptance:
- unit tests pass
- manual smoke checklist pass

## 13. Manual smoke checklist

- namespace 선택
- pod 선택
- APP stream start
- ACC stream start
- ERR stream start
- grep 입력/변경
- pause/resume
- clear
- source 변경
- app exit cleanup
```

---

## 5. DESIGN.md에 추가/수정할 정확한 섹션

### 5.1 `## 5. Tail Contract`에 추가

```md
### 5.3 stdout line splitting

Rust process manager는 stdout을 chunk 단위로 읽고 newline 기준으로 완성된 line만 frontend로 emit한다.

정책:

- UTF-8 변환은 `String::from_utf8_lossy`를 사용한다.
- `\n` 기준으로 line을 분리한다.
- line 끝의 `\r`은 제거한다.
- 완성되지 않은 partial line은 stream별 internal buffer에 보관한다.
- process 종료 시 partial line이 비어 있지 않으면 마지막 raw line으로 emit한다.
```

---

### 5.2 `## 10. ParsedLogLine 데이터 모델`에 추가

```md
### 10.1 Identity rules

- `id`는 frontend log store에서 부여하는 monotonic number다.
- `streamId`는 stream start마다 생성되는 UUID다.
- `sourceId`는 source identity를 나타내는 deterministic key다.

권장 sourceId:

```ts
const sourceId = `${namespace}/${pod}/${container}/${sourceType}/${filePath}`
```

frontend는 현재 activeStreamId와 다른 streamId의 event를 stale event로 보고 무시한다.
```

---

### 5.3 `## 11. Parser 설계`에 추가

```md
### 11.3 Display time priority

표시 시간은 다음 우선순위를 따른다.

1. `epochTime`이 valid number이면 `epochTime`
2. `time`이 valid date string이면 `time`
3. 둘 다 없거나 invalid이면 `receivedAt`

### 11.4 Parser fixture requirements

v0.1 parser는 최소한 다음 fixture로 테스트한다.

- valid ACC JSON
- valid ERR JSON
- valid APP JSON with `message`
- valid APP JSON with `body` string
- valid APP JSON with `body` object
- invalid JSON raw line
- ACC `status` as string
- ACC `status` as number
- ERR `errors` empty array
- ERR without `body.errorDetails`
```

---

### 5.4 `## 12. Search Contract`에 추가

```md
v0.1 grep semantics:

- plain substring match만 지원한다.
- regex는 지원하지 않는다.
- 기본은 case-insensitive match다.
- 검색어 앞뒤 공백은 trim한다.
- 빈 검색어는 모든 line을 표시한다.
- grep 대상은 `ParsedLogLine.raw`이다.
```

---

### 5.5 `## 14. Ring Buffer`에 추가

```md
### 14.1 Clear behavior

Clear는 현재 ring buffer와 visible list를 비운다.

- tail process는 중단하지 않는다.
- grep input은 유지한다.
- stream status는 유지한다.
- 이후 들어오는 log는 동일 stream에 계속 append된다.

### 14.2 bufferLimit validation

`bufferLimit`은 integer여야 하며 v0.1에서는 1,000 이상 200,000 이하로 제한한다.
UI preset은 10,000 / 50,000 / 100,000을 제공한다.
```

---

### 5.6 `## 15. Pause / Resume` 수정

```md
Pause 중에도 incoming logs는 ring buffer에 저장한다.
단, visible list append와 auto-scroll은 중지한다.

Resume 시:

- 현재 grep 조건을 기준으로 ring buffer 전체를 다시 filtering한다.
- pause 중 bufferLimit 초과로 drop된 line이 있으면 dropped count를 표시한다.

v0.1에서는 Pause 중 grep 입력 변경을 허용한다.
변경된 grep 결과는 Resume 시 visible list에 반영한다.
```

---

### 5.7 `## 17. Log Source Mapping`에 추가

```md
### 17.1.1 v0.1 settings persistence

v0.1은 Tauri app config directory에 `settings.json`을 저장한다.

설정 항목:

- defaultNamespace
- initialTailLines
- bufferLimit
- APP/ACC/ERR source mapping
  - label
  - container
  - filePath

첫 실행 시 기본 설정을 생성한다.
설정 로드 실패 시 기본값으로 fallback하고 warning을 표시한다.
설정 저장 전 validation을 수행한다.

v0.1은 Settings 화면 또는 modal에서 source mapping을 수정할 수 있어야 한다.
```

---

### 5.8 `## 18. UI 설계`에 추가

```md
### 18.4 v0.1 source selection policy

v0.1에서는 APP/ACC/ERR 중 하나만 active source로 선택할 수 있다.
동시에 여러 source를 tail하지 않는다.

source type을 변경하면:

1. 기존 stream을 stop한다.
2. ring buffer와 visible list를 clear한다.
3. 새 source mapping으로 stream을 시작한다.

APP/ACC/ERR UI는 multi-select가 아니라 single-select segmented control이다.
```

---

### 5.9 `## 19. Process Lifecycle`에 추가

```md
### 19.3 Stream identity and stale events

stream 시작 시 frontend는 새 `streamId`를 생성한다.
모든 stream event는 `streamId`를 포함한다.

frontend는 `event.streamId !== activeStreamId`인 event를 stale event로 보고 무시한다.

이 정책은 namespace/pod/source 변경 중 이전 process에서 늦게 도착한 stdout이 새 화면에 섞이는 것을 방지한다.
```

`19.1 필수 lifecycle 규칙`에 추가:

```text
- stream stop 중 도착한 stale event는 UI에 반영하지 않는다.
- v0.1은 stream disconnected/pod restarted 시 자동 reconnect하지 않는다.
- process 비정상 종료 후 사용자가 다시 Start할 수 있어야 한다.
```

---

### 5.10 `## 20. Process Safety`에 추가

```md
`initialTailLines`는 spawn 전에 string으로 변환한다.
shell escaping을 직접 수행하지 않는다.
```

validation에 추가:

```text
- initialTailLines는 0 이상 100000 이하 integer여야 한다.
- bufferLimit은 1000 이상 200000 이하 integer여야 한다.
```

---

### 5.11 `## 21. 에러 처리` 수정

```md
### 21.1 Fatal stream errors

- kubectl not found
- kubeconfig/context not found
- namespace list failed
- pod list failed
- pod not found
- container not found
- kubectl exec forbidden / RBAC pods/exec denied
- tail command not found
- tail -F unsupported
- log file not found
- permission denied reading log file
- stream disconnected
- pod restarted

### 21.2 Non-fatal line handling

- JSON parse failed
- unknown JSON schema
- missing optional fields
```

stderr 정책 추가:

```md
### 21.x stderr handling

stderr line은 즉시 fatal로 간주하지 않는다.
stderr는 latest warning 또는 stream diagnostic으로 표시한다.
process가 non-zero exit code로 종료된 경우 fatal stream error로 처리한다.
```

---

### 5.12 Tauri API contract 섹션 추가

새 섹션 권장:

```md
## Tauri Command and Event Contract
```

추가 내용:

```ts
type ListNamespacesResponse = {
  namespaces: string[]
}

type PodSummary = {
  name: string
  phase: string
  containers: string[]
  restartCount?: number
}

type ListPodsResponse = {
  pods: PodSummary[]
}

type StartLogStreamRequest = {
  streamId: string
  namespace: string
  pod: string
  container: string
  sourceType: SourceLogType
  filePath: string
  initialTailLines: number
}

type LogLineEvent = {
  streamId: string
  sourceType: SourceLogType
  namespace: string
  pod: string
  container: string
  filePath: string
  line: string
  receivedAt: number
}

type LogStreamStderrEvent = {
  streamId: string
  line: string
  receivedAt: number
}

type LogStreamExitEvent = {
  streamId: string
  exitCode?: number
  signal?: string
}

type LogStreamErrorEvent = {
  streamId: string
  message: string
  details?: string
}
```

명령 목록:

```text
- getCurrentContext()
- listNamespaces()
- listPods(namespace)
- startLogStream(request)
- stopLogStream(streamId)
- stopAllLogStreams()
```

---

### 5.13 아키텍처 pipeline 수정

현재 pipeline은 parser와 store 순서가 모호하다.

권장 수정:

```text
Tauri event receive
  ↓
TypeScript parser
  ↓
React log store / ring buffer
  ↓
grep filter
  ↓
virtualized log viewer
```

---

### 5.14 초기 파일 구조 보완

추가 권장:

```text
src/
  commands/
    tauriLogs.ts
    tauriKube.ts
  config/
    defaultSettings.ts
    validateSettings.ts
  utils/
    ringBuffer.ts
  __fixtures__/
    acc.valid.jsonl
    err.valid.jsonl
    app.valid.jsonl
    invalid.jsonl
  __tests__/
    parseLogLine.test.ts
    grep.test.ts
    ringBuffer.test.ts
src-tauri/
  src/
    process/
      line_splitter.rs
    settings/
      mod.rs
```

---

### 5.15 v0.1 Scope 보완

`26.2 필수 기능`에 추가:

```text
- current context 표시
- Start/Stop stream control
- streamId 기반 stale event discard
- stdout line splitting
- settings load/save 또는 명시적 default mapping strategy
- source mapping validation
- plain substring grep semantics
- parser unit fixtures
```

`26.4 v0.1 제외`에 추가:

```text
- automatic reconnect
- kube context switching
- simultaneous APP/ACC/ERR tail
- settings sync/cloud persistence
```

---

### 5.16 v0.1 성공 기준 보완

`28.1 v0.1 성공 기준`에 추가:

```text
12. stdout chunk가 line 단위로 안정적으로 분리된다.
13. source/pod 변경 중 stale event가 새 화면에 섞이지 않는다.
14. invalid JSON line은 stream error가 아니라 raw row로 표시된다.
15. kubectl/tail/process error가 stream status area에 표시된다.
16. 설정값 validation이 동작한다.
17. parser/grep/ring buffer unit test가 통과한다.
```

---

## 6. 구현문서 전환 가능 여부

판정:

```text
Not ready yet.
```

이유:

- 제품 scope는 충분하지만 구현 단위의 sequence가 부족하다.
- Rust/TypeScript boundary contract가 없다.
- Kubernetes discovery command와 settings persistence가 미정이다.
- stream identity/stale event/stdout splitting 같은 실제 구현 핵심이 빠져 있다.
- v0.1 acceptance criteria가 테스트 가능한 수준까지 내려오지 않았다.

권장 순서:

1. `docs/DESIGN.md`에 위의 필수 섹션 보완
2. v0.1 user flow와 Tauri command/event contract 확정
3. settings strategy 확정
4. parser/search/ring buffer 테스트 기준 추가
5. 그 후 `docs/plans/v0.1-implementation.md` 작성

---

## 7. 리뷰 작업 요약

- `/Users/yprite/klogcat/docs/DESIGN.md`를 독립 에이전트가 직접 읽고 검토했다.
- 구현문서로 전환하기 위해 필요한 누락 결정, 모호한 부분, sequencing 문제를 정리했다.
- 코드 구현은 하지 않았다.
- 주요 발견사항:
  - 설계 방향은 좋지만 구현 계약이 부족하다.
  - Tauri command/event contract가 반드시 필요하다.
  - settings persistence와 Kubernetes discovery 세부 정책이 빠져 있다.
  - stdout line splitting, streamId, stale event 처리, stderr 처리 정책이 구현 안정성의 핵심 gap이다.
  - v0.1 계획 문서로 전환하려면 milestone/acceptance/test 기준을 먼저 보강해야 한다.
