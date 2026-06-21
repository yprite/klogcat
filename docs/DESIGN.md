# klogcat 설계문서

## 1. 제품 정의

**Repository name:** `klogcat`

**제품명:** `klogcat`

**한 줄 설명:**

> `klogcat`은 Kubernetes pod 내부의 APP, ACC, ERR 서버 로그 파일을 대상으로 하는 tail 기반 데스크톱 GUI다. `kubectl exec ... tail -n <N> -F <file>`로 로그 파일을 실시간 추적하고, JSON Lines를 best-effort로 파싱하며, Android Logcat처럼 실시간 grep/filter를 제공한다.

---

## 2. 핵심 원칙

`klogcat`은 다음 원칙을 따른다.

```text
1. tail 기반 도구다.
2. APP / ACC / ERR 로그 파일을 대상으로 한다.
3. kubectl exec ... tail -F 로 로그를 수집한다.
4. kubectl logs -f 기반 stdout 로그 뷰어가 아니다.
5. 검색은 grep 스타일 문자열 매칭이다.
6. 구조화된 쿼리 언어를 제공하지 않는다.
7. v0.2에서 기능적으로 완성된다.
```

중요한 비목표:

```text
- kubectl logs -f 기반 container stdout 로그 보기
- Loki / Elasticsearch / DB 연동
- 로그 장기 저장
- metrics / tracing / alerting
- AI 로그 분석
- Kubernetes observability dashboard
- 구조화 쿼리 언어
```

---

## 3. 제품 목표

`klogcat`의 목표는 단순하다.

```text
Kubernetes pod 내부의 서버 로그 파일을
tail -F로 실시간 추적하고,
grep처럼 즉시 필터링한다.
```

개발자가 기존에 하던 작업:

```bash
kubectl exec -n backend api-server-xxx -c app -- tail -F /var/log/app/info.log
kubectl exec -n backend api-server-xxx -c app -- tail -F /var/log/app/access.log
kubectl exec -n backend api-server-xxx -c app -- tail -F /var/log/app/error.log
```

이 흐름을 GUI로 빠르게 제공한다.

### 3.1 v0.1 User Flow

v0.1의 기본 실행 흐름은 아래와 같다.

```text
1. 앱 시작 시 kubectl config current-context를 호출해 현재 context를 표시한다.
2. kubectl get namespaces -o json으로 namespace 목록을 불러온다.
3. 사용자가 namespace를 선택하면 kubectl get pods -n <namespace> -o json으로 pod 목록을 불러온다.
4. 사용자가 pod와 source type(APP/ACC/ERR)을 선택한다.
5. 사용자가 Start를 누르면 기존 stream을 정리하고 새 tail stream을 시작한다.
6. source type, namespace, pod 변경 시 실행 중인 stream은 stop되고 buffer는 clear된다.
7. grep 입력은 stream 변경 시 유지한다. Clear 버튼은 buffer만 비운다.
```

### 3.2 Kubernetes discovery policy

v0.1은 현재 kube context만 사용한다. 앱 내부에서 context 변경은 지원하지 않고, 현재 context는 read-only로 표시한다.

사용 명령:

```text
current context:
kubectl config current-context

namespace list:
kubectl get namespaces -o json

pod list:
kubectl get pods -n <namespace> -o json

container validation:
listPods(namespace) 응답의 containers[] 사용
```

pod 표시 정책:

```text
- v0.1은 Running pod만 Start 가능하다.
- Non-running pod는 목록에 표시할 수 있으나 Start 버튼은 disabled 처리하거나 Start validation error를 표시한다.
- container는 source mapping의 container 값을 사용한다.
- listPods(namespace)는 각 pod의 containers[]를 포함한다.
- Start 전 frontend는 selected pod의 containers[]에 source mapping container가 있는지 검증한다.
- v0.1에서는 별도 getPod 또는 validateContainer command를 만들지 않는다.
- Start 직전 validation 후 pod/container가 stale 상태가 되어 실제 exec에서 container not found가 나면 start error로 처리한다.
```

---

## 4. 로그 대상

`klogcat`은 세 가지 로그 파일 타입을 다룬다.

```text
APP = application / info log file
ACC = access log file
ERR = error log file
```

예시 매핑:

```text
APP → /var/log/app/info.log
ACC → /var/log/app/access.log
ERR → /var/log/app/error.log
```

### 4.1 Source Type과 JSON logType 구분

`APP / ACC / ERR`는 **파일 소스 타입**이다.

반면 JSON 내부의 `logType` 필드는 로그 데이터의 내부 타입 또는 레벨이다.
따라서 둘은 반드시 분리해서 처리한다.

예:

```json
{
  "logType": "INFO"
}
```

위 로그가 ERR 파일 안에 있을 수 있다.

즉:

```text
ERR = error log file source
INFO = JSON 내부 logType
```

타입 정의:

```ts
type SourceLogType = 'app' | 'access' | 'error'
type JsonLogType = string
```

명명 규칙:

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

UI에서는 다음처럼 함께 표시할 수 있다.

```text
09:20:04.226 ERR INFO POST /internal/open-tab/migration OpenTabMigrationFailedException...
```

여기서:

```text
ERR  = 파일 타입
INFO = JSON 내부 logType
```

---

## 5. Tail Contract

`klogcat`은 로그 수집을 위해 반드시 `tail -F`를 사용한다.

명령 형식:

```bash
kubectl exec -n <namespace> <pod> -c <container> -- tail -n <initialTailLines> -F <filePath>
```

예:

```bash
kubectl exec -n backend api-server-7d9f8c -c app -- tail -n 200 -F /var/log/app/info.log
kubectl exec -n backend api-server-7d9f8c -c app -- tail -n 200 -F /var/log/app/access.log
kubectl exec -n backend api-server-7d9f8c -c app -- tail -n 200 -F /var/log/app/error.log
```

### 5.1 initialTailLines

앱 실행 시 최근 N줄을 먼저 보여준 뒤 follow한다.

기본값:

```text
initialTailLines = 200
```

설정 예:

```json
{
  "initialTailLines": 200
}
```

의미:

```text
0    = 앱 실행 이후 새 로그만 표시
10   = tail 기본값과 유사
200  = 기본값, 최근 맥락 확인 가능
1000 = 더 많은 초기 로그 확인
```

### 5.2 tail -F 요구사항

`klogcat`은 대상 container 안에 `tail -F`를 지원하는 명령이 있다고 가정한다.

필수 조건:

```text
- 대상 container에 tail 명령이 있어야 한다.
- tail은 -F 옵션을 지원해야 한다.
- Kubernetes RBAC에서 pods/exec 권한이 있어야 한다.
- 대상 로그 파일을 읽을 권한이 있어야 한다.
```

v0.1에서는 `tail -F`만 지원한다.

`tail -f` fallback은 실제 대상 container에서 `-F` 문제가 확인될 경우에만 추후 고려한다.

### 5.3 stdout line splitting

Rust process manager는 stdout을 chunk 단위로 읽고, stream별 byte buffer를 사용해 newline 기준으로 완성된 line만 frontend로 emit한다.

중요한 구현 원칙:

```text
chunk를 먼저 String으로 변환하지 않는다.
UTF-8 멀티바이트 문자가 chunk 경계에서 잘릴 수 있기 때문이다.
```

정책:

```text
- stream별 partial buffer는 Vec<u8>로 유지한다.
- stdout chunk bytes를 partial buffer에 append한다.
- delimiter는 LF byte(0x0A)다.
- byte 기준으로 LF(0x0A) 위치를 찾는다.
- 완성된 line bytes에 대해서만 UTF-8 decode한다.
- decode 실패 시 해당 line에만 String::from_utf8_lossy를 적용한다.
- emit 전 delimiter LF(0x0A)는 제외한다.
- LF 바로 앞에 trailing CR byte(0x0D)가 있으면 제거한다.
- line 내부의 CR byte(0x0D)는 보존한다.
- process 종료 시 partial buffer가 비어 있지 않으면 동일 규칙으로 trailing CR(0x0D)만 제거한 뒤 마지막 line으로 decode 후 emit한다.
```

필수 line splitter fixture:

```text
- 한 line이 여러 chunk로 나뉘는 경우
- 한 chunk에 여러 line이 포함된 경우
- CRLF line ending: `a\r\nb\r\n` 입력은 `a`, `b` 두 line을 emit한다.
- trailing newline 없는 partial line flush
- UTF-8 multibyte character가 chunk 경계에서 나뉘는 경우
```

---

## 6. JSON Lines Contract

ACC / ERR 로그는 기본적으로 **JSON Lines** 형식이라고 가정한다.

```text
1 line = 1 complete JSON object
```

예:

```json
{"time":"2025-03-19T09:20:04.227Z","logType":"ACCESS","method":"POST","url":"/data/internal/open-tab/migration","status":"500"}
```

중요 제약:

```text
- 각 줄은 완전한 JSON object여야 한다.
- pretty-printed multi-line JSON은 v0.1에서 지원하지 않는다.
- JSON parse 실패는 stream error가 아니다.
- JSON parse 실패 시 raw line으로 표시한다.
```

APP 로그는 아직 스키마가 확정되지 않았으므로 generic best-effort parser로 처리한다.

---

## 7. ACC log 설계

### 7.1 ACC log 예시

```json
{
  "time": "2025-03-19T09:20:04.227Z",
  "logType": "ACCESS",
  "host": "p2cn1dapimigrator-s139243",
  "service": "Scloud",
  "module": "dapi",
  "trId": "open-tab-migration-go_25007c7c-f8e1-482d-98d1-1dc2f90ad82b",
  "epochTime": 1742376004227,
  "pSpanId": "-1",
  "spanId": "dapi7426061",
  "method": "POST",
  "url": "/data/internal/open-tab/migration",
  "length": 14,
  "srcIp": "10.252.12.93",
  "elapsed": 11908,
  "status": "500",
  "userId": "OBWyUQzU1QhiHxnGGafAKg==",
  "appId": "c27bh39q4z",
  "serviceId": "dapi",
  "body": {
    "rcode": "5000999",
    "rmsg": "Internal Server Error",
    "exceptionName": "OpenTabMigrationFailedException",
    "api_name": "triggerOpenTabMigration"
  }
}
```

### 7.2 ACC parser requirements

ACC parser는 다음 필드를 best-effort로 추출한다.

```text
- time
- logType
- host
- service
- module
- serviceId
- trId
- epochTime
- pSpanId
- spanId
- method
- url
- length
- srcIp
- elapsed
- status
- userId
- appId
- body.rcode
- body.rmsg
- body.exceptionName
- body.api_name
```

알려진 `body` 필드는 summary에 사용할 수 있다.

알 수 없는 `body` 필드는 별도 파싱하지 않아도 된다. 단, raw line grep을 통해 검색 가능해야 한다.

### 7.3 ACC row 표시

ACC log는 raw JSON 그대로 보여주지 않고 핵심 필드 중심으로 표시한다.

권장 row 포맷:

```text
time | ACC | status | method | url | elapsed | module | summary | trId
```

예:

```text
09:20:04.227 ACC 500 POST /data/internal/open-tab/migration 11908ms dapi OpenTabMigrationFailedException rcode=5000999 trId=open-tab-migration-go_25007...
```

### 7.4 ACC summary 생성 규칙

ACC summary는 다음 우선순위로 만든다.

```text
1. method + url + status + elapsed
2. body.rcode
3. body.rmsg
4. body.exceptionName
5. body.api_name
```

예:

```text
POST /data/internal/open-tab/migration 500 11908ms rcode=5000999 exception=OpenTabMigrationFailedException api=triggerOpenTabMigration
```

### 7.5 ACC status 처리

`status`는 문자열일 수 있다.

예:

```json
"status": "500"
```

따라서 방어적으로 숫자 변환한다.

```ts
const statusCode = Number(status)
```

변환 실패 시 neutral로 처리한다.

v0.2 색상 규칙:

```text
2xx = green
3xx = blue
4xx = yellow
5xx = red
unknown = neutral
```

### 7.6 ACC elapsed 처리

`elapsed`는 milliseconds로 취급한다.

예:

```json
"elapsed": 11908
```

표시:

```text
11908ms
```

v0.2 색상 권장:

```text
< 300ms      = neutral
300~1000ms   = muted / yellow
1000~5000ms  = orange
>= 5000ms    = red
```

---

## 8. ERR log 설계

### 8.1 ERR log 예시

```json
{
  "time": "2025-03-19T09:20:04.226Z",
  "logType": "INFO",
  "host": "p2cn1dapimigrator-s139243",
  "logger": "com.sec.scloud.dapi.fig.adapter.in.aop.ErrorLoggingAspect",
  "service": "Scloud",
  "module": "dapi",
  "submodule": null,
  "trId": "open-tab-migration-go_25007c7c-f8e1-482d-98d1-1dc2f90ad82b",
  "epochTime": 1742376004226,
  "thread": "http-nio-10080-exec-3301",
  "body": {
    "errorDetails": {
      "serverName": "dapi",
      "path": "/internal/open-tab/migration",
      "method": "POST",
      "timestamp": "2025-03-19T09:20:04.226Z",
      "traceId": "open-tab-migration-go_25007c7c-f8e1-482d-98d1-1dc2f90ad82b",
      "errors": [
        {
          "reason": "OpenTabMigrationFailedException: fail to migrate - open tab migration validation failed"
        }
      ]
    }
  }
}
```

### 8.2 ERR parser requirements

ERR parser는 다음 필드를 best-effort로 추출한다.

```text
- time
- logType
- host
- logger
- service
- module
- submodule
- trId
- epochTime
- thread
- body.errorDetails.serverName
- body.errorDetails.path
- body.errorDetails.method
- body.errorDetails.timestamp
- body.errorDetails.traceId
- body.errorDetails.errors[].reason
```

### 8.3 ERR row 표시

권장 row 포맷:

```text
time | ERR | jsonLogType | method | path | module | reason | trId
```

예:

```text
09:20:04.226 ERR INFO POST /internal/open-tab/migration dapi OpenTabMigrationFailedException: fail to migrate - open tab migration validation failed trId=open-tab-migration-go_25007...
```

### 8.4 ERR summary 생성 규칙

ERR summary는 다음 우선순위로 만든다.

```text
1. body.errorDetails.errors[0].reason
2. body.errorDetails.method + body.errorDetails.path
3. logger
4. raw line
```

여러 개의 errors가 있을 경우:

```text
- v0.1 row에서는 첫 번째 reason만 표시한다.
- 전체 errors는 raw line에 남아 있으므로 grep 가능하다.
```

### 8.5 trId / traceId 우선순위

ERR log에서는 `trId`와 `body.errorDetails.traceId`가 모두 있을 수 있다.

우선순위:

```text
primaryTraceId = trId ?? body.errorDetails.traceId
```

둘 다 있고 값이 다를 경우:

```text
- trId를 primary로 표시한다.
- traceId는 parsed field로 보존한다.
- raw grep은 둘 다 검색할 수 있다.
```

---

## 9. APP log 설계

APP log 스키마는 아직 확정하지 않는다.

APP parser는 generic best-effort로 동작한다.

### 9.1 APP parser 기본 규칙

```text
1. JSON.parse를 시도한다.
2. 성공하면 공통 필드를 추출한다.
3. message 필드가 있으면 summary로 사용한다.
4. body가 string이면 summary로 사용한다.
5. body가 object이면 compact JSON 문자열로 summary를 만든다.
6. 실패하면 raw line을 summary로 사용한다.
```

예상 타입:

```ts
type AppLogJson = {
  time?: string
  logType?: string
  host?: string
  logger?: string
  service?: string
  module?: string
  trId?: string
  epochTime?: number
  thread?: string
  message?: string
  body?: unknown
  [key: string]: unknown
}
```

---

## 10. ParsedLogLine 데이터 모델

v0.1에서는 메모리 사용을 줄이기 위해 전체 parsed object를 저장하지 않는다.

원본은 `raw`에 보존하고, UI에 필요한 주요 필드만 추출한다.

```ts
type SourceLogType = 'app' | 'access' | 'error'

type ParsedLogLine = {
  id: number

  // Stream identity
  sourceId: string
  streamId: string

  // Source metadata
  sourceType: SourceLogType
  namespace: string
  pod: string
  container: string
  filePath: string

  // Time
  timestamp?: string
  epochTime?: number
  receivedAt: number

  // Common JSON fields
  jsonLogType?: string
  host?: string
  service?: string
  module?: string
  trId?: string
  traceId?: string

  // Access-specific fields
  method?: string
  url?: string
  status?: string
  elapsed?: number
  srcIp?: string
  userId?: string
  appId?: string
  rcode?: string
  rmsg?: string
  exceptionName?: string
  apiName?: string

  // Error-specific fields
  logger?: string
  thread?: string
  errorPath?: string
  errorMethod?: string
  errorReason?: string

  // Render/search
  summary: string
  raw: string
  parseStatus: 'parsed' | 'raw'
}
```

필요할 경우 detail view에서 `JSON.parse(raw)`를 다시 수행한다.

### 10.1 Identity rules

```text
- id는 frontend log store에서 부여하는 monotonic number다.
- id는 앱 실행 중 전역 증가하며 stream 재시작 시 reset하지 않는다.
- streamId는 stream start마다 생성되는 UUID다.
- sourceId는 source identity를 나타내는 deterministic key다.
```

권장 sourceId:

```ts
const sourceId = `${namespace}/${pod}/${container}/${sourceType}/${filePath}`
```

frontend는 현재 `activeStreamId`와 다른 `streamId`의 event를 stale event로 보고 무시한다.

---

## 11. Parser 설계

### 11.1 parseLogLine

```ts
function parseLogLine(
  raw: string,
  sourceType: SourceLogType,
  sourceMeta: SourceMeta,
  receivedAt: number
): ParsedLogLine {
  try {
    const json = JSON.parse(raw)

    if (sourceType === 'access') {
      return parseAccessLog(json, raw, sourceMeta, receivedAt)
    }

    if (sourceType === 'error') {
      return parseErrorLog(json, raw, sourceMeta, receivedAt)
    }

    return parseAppLog(json, raw, sourceMeta, receivedAt)
  } catch {
    return parseRawLog(raw, sourceType, sourceMeta, receivedAt)
  }
}
```

TypeScript parser는 backend event의 `event.receivedAt`을 `parseLogLine`에 전달한다. `Date.now()` fallback은 unit test나 legacy caller에서만 허용한다.

### 11.2 JSON parse 실패 처리

JSON parse 실패는 stream error가 아니다.

동작:

```text
- raw line으로 표시한다.
- parseStatus = 'raw'
- grep 대상에는 포함한다.
- 앱 전체 에러로 표시하지 않는다.
```

`parseStatus` 기준:

```text
- JSON.parse 성공: parsed
- JSON.parse 실패: raw
- JSON.parse 성공했지만 일부 필드 누락: parsed
```

### 11.3 Display time priority

표시 시간은 다음 우선순위를 따른다.

```text
1. epochTime이 valid number이면 epochTime
2. time이 valid date string이면 time
3. 둘 다 없거나 invalid이면 receivedAt
```

### 11.4 Parser fixture requirements

v0.1 parser는 최소한 다음 fixture로 테스트한다.

```text
- valid ACC JSON: parseStatus는 parsed, status/elapsed/method/url/trId 주요 필드를 채운다.
- valid ERR JSON: parseStatus는 parsed, errorReason/errorMethod/errorPath/trId 주요 필드를 채운다.
- valid APP JSON with message: parseStatus는 parsed, summary는 message를 우선 사용한다.
- valid APP JSON with body string: summary는 body string을 사용한다.
- valid APP JSON with body object: summary는 compact JSON 문자열을 사용한다.
- invalid JSON raw line: parseStatus는 raw, summary와 raw는 원문을 보존한다.
- ACC status as string
- ACC status as number
- ERR errors empty array: errorReason 없이 parsed로 유지한다.
- ERR without body.errorDetails: 가능한 공통 필드만 채우고 parsed로 유지한다.
```

---

## 12. Search Contract

### 12.1 v0.1 검색

v0.1에서 grep은 raw line 기준이다.

```text
grep 대상 = ParsedLogLine.raw
```

v0.1 grep semantics:

```text
- plain substring match만 지원한다.
- regex는 지원하지 않는다.
- 기본은 case-insensitive match다.
- 비교는 query.trim().toLowerCase()와 raw.toLowerCase()로 수행한다.
- v0.1에서는 locale/unicode normalization을 수행하지 않는다.
- 검색어 앞뒤 공백은 trim한다.
- 빈 검색어는 모든 line을 표시한다.
```

장점:

```text
- trId 검색 가능
- status 검색 가능
- url 검색 가능
- exceptionName 검색 가능
- rcode 검색 가능
- userId 검색 가능
- appId 검색 가능
- body 내부 unknown field 검색 가능
```

검색어 변경 시:

```text
- tail process를 재시작하지 않는다.
- 현재 ring buffer 전체에 grep을 즉시 재적용한다.
```

즉:

```text
1. 로그 1000줄 수신
2. 사용자가 "OpenTabMigrationFailedException" 입력
3. 기존 1000줄 중 매칭되는 줄만 즉시 표시
4. 이후 들어오는 로그도 같은 grep 기준으로 표시
```

### 12.2 v0.2 검색

v0.2에서는 검색 대상을 확장할 수 있다.

```text
grep 대상 = rendered summary + raw line
```

단, 구조화 쿼리 언어는 제공하지 않는다.

제외 예:

```text
status:500
elapsed>1000
method=POST
url~migration
```

명시:

```text
klogcat does not implement a structured query language.
All filtering remains grep-style text matching.
Quick filters only populate the grep input with selected text.
```

### 12.3 Highlight

v0.1:

```text
raw line 기준 match 여부를 판단한다.
rendered summary에서 일치 문자열이 보이면 best-effort로 highlight한다.
raw-only match인 경우 highlight를 생략해도 되지만 row는 표시한다.
```

v0.2:

```text
rendered summary + raw line 기준으로 match한다.
raw-only match일 경우 row-level match indicator만 표시해도 된다.
```

---

## 13. trId / traceId Quick Filter

v0.2에서는 `trId` 또는 `traceId`를 빠르게 grep 입력창에 넣는 기능을 제공한다.

이 기능은 trace correlation이 아니다.

동작:

```text
1. 로그 라인에서 trId 또는 traceId 감지
2. 사용자가 quick filter 액션 선택
3. grep input에 해당 값 입력
4. 현재 ring buffer 전체에 grep 적용
```

예:

```text
[Filter by trId]
```

결과:

```text
grep = open-tab-migration-go_25007c7c-f8e1-482d-98d1-1dc2f90ad82b
```

---

## 14. Ring Buffer

로그는 무한히 쌓지 않는다.

기본값:

```text
bufferLimit = 50,000 lines
```

설정 가능:

```text
10,000
50,000
100,000
```

동작:

```text
- 새 로그가 들어오면 ring buffer에 추가한다.
- bufferLimit을 넘으면 가장 오래된 줄을 제거한다.
- grep은 현재 ring buffer 전체에 적용된다.
```

### 14.1 Clear behavior

Clear는 현재 ring buffer와 visible list를 비운다.

```text
- tail process는 중단하지 않는다.
- grep input은 유지한다.
- stream status는 유지한다.
- line id counter는 reset하지 않는다.
- 이후 들어오는 log는 동일 stream에 계속 append된다.
```

### 14.2 bufferLimit validation

```text
- bufferLimit은 integer여야 한다.
- v0.1에서는 1,000 이상 200,000 이하로 제한한다.
- UI preset은 10,000 / 50,000 / 100,000을 제공한다.
```

---

## 15. Pause / Resume

Pause는 tail process를 중단하지 않는다.

정의:

```text
Pause = 화면 갱신 / append 중지
tail process = 계속 실행
incoming logs = ring buffer에 계속 저장
```

Resume 시:

```text
- 현재 grep 조건을 기준으로 ring buffer 전체를 다시 filtering한다.
- pause 중 수신된 로그를 화면에 반영한다.
- pause 중 bufferLimit 초과로 drop된 line이 있으면 dropped count를 표시한다.
```

v0.1에서는 Pause 중 grep 입력 변경을 허용한다.
변경된 grep 결과는 Resume 시 visible list에 반영한다.

Pause 중 buffer overflow가 발생하면:

```text
- 오래된 로그는 drop된다.
- UI에 dropped line count를 표시한다.
```

예:

```text
Paused. 12,430 lines buffered. 3,200 old lines dropped.
```

---

## 16. Multi-source Stream Ordering

v0.2에서는 여러 pod와 여러 log type을 동시에 tail할 수 있다.

이 경우 각 source마다 별도 tail process가 실행된다.

정렬 정책:

```text
klogcat renders multi-source logs in arrival order.
It does not guarantee strict timestamp ordering across pods or log types.
```

한국어:

```text
다중 source 로그는 도착 순서대로 표시한다.
pod 또는 log type 간 엄격한 timestamp 정렬은 보장하지 않는다.
```

이유:

```text
- 실시간성 유지
- timestamp parsing 실패 가능성
- delay buffer 불필요
- 구현 단순성 유지
```

---

## 17. Log Source Mapping

### 17.1 v0.1 기본 매핑

v0.1에서는 APP / ACC / ERR 각각에 대해 container와 filePath를 설정한다.

`sourceType`과 display label은 고정값에서 derive한다. v0.1 settings에는 `label`을 저장하지 않는다.

```ts
type LogSourceConfig = {
  container: string
  filePath: string
}

type PersistedSettings = {
  schemaVersion: 1
  defaultNamespace?: string
  initialTailLines: number
  bufferLimit: number
  logSources: Record<SourceLogType, LogSourceConfig>
}

const sourceLabels: Record<SourceLogType, 'APP' | 'ACC' | 'ERR'> = {
  app: 'APP',
  access: 'ACC',
  error: 'ERR',
}
```

예:

```json
{
  "schemaVersion": 1,
  "defaultNamespace": "backend",
  "initialTailLines": 200,
  "bufferLimit": 50000,
  "logSources": {
    "app": {
      "container": "app",
      "filePath": "/var/log/app/info.log"
    },
    "access": {
      "container": "app",
      "filePath": "/var/log/app/access.log"
    },
    "error": {
      "container": "app",
      "filePath": "/var/log/app/error.log"
    }
  }
}
```

### 17.1.1 v0.1 settings persistence

v0.1에서 settings persistence는 필수 범위다. APP/ACC/ERR 파일 경로와 container mapping은 제품 사용성의 핵심이므로, 앱 재시작 후에도 보존되어야 한다.

저장 위치:

```text
Tauri app config dir / settings.json
```

persisted settings schema:

```ts
type PersistedSettings = {
  schemaVersion: 1
  defaultNamespace?: string
  initialTailLines: number
  bufferLimit: number
  logSources: Record<SourceLogType, LogSourceConfig>
}

type LogSourceConfig = {
  container: string
  filePath: string
}
```

예시:

```json
{
  "schemaVersion": 1,
  "defaultNamespace": "default",
  "initialTailLines": 500,
  "bufferLimit": 50000,
  "logSources": {
    "app": {
      "container": "app",
      "filePath": "/var/log/app/info.log"
    },
    "access": {
      "container": "app",
      "filePath": "/var/log/app/access.log"
    },
    "error": {
      "container": "app",
      "filePath": "/var/log/app/error.log"
    }
  }
}
```

validation:

```text
- schemaVersion은 1이어야 한다.
- initialTailLines는 0 이상 100000 이하 integer여야 한다.
- bufferLimit은 1000 이상 200000 이하 integer여야 한다.
- logSources key는 정확히 app/access/error여야 한다.
- APP/ACC/ERR 같은 uppercase key는 invalid다.
- settings top-level extra key는 reject한다.
- logSources와 각 source config의 extra key는 reject한다.
- source.container는 비어 있으면 안 된다.
- source.filePath는 absolute path여야 한다.
- source.filePath에는 null byte가 있으면 안 된다.
```

load/save 정책:

```text
- 설정 파일이 없으면 default settings를 생성하고 저장한다.
- 설정 파일 읽기 실패 또는 JSON parse 실패 시 default settings로 fallback하고 UI에 warning을 표시한다.
- 읽기 실패 또는 JSON parse 실패가 난 기존 파일은 자동 overwrite하지 않는다.
- validation 실패 시 default settings로 fallback하지 않고 SettingsValidationError[] 또는 SettingsLoadError로 reject한다.
- saveSettings는 validation 실패 시 reject하고 파일을 변경하지 않는다.
- saveSettings는 PersistedSettings만 입력받으므로 warning을 저장하지 않는다.
- 저장은 가능한 경우 temp file + rename 방식으로 atomic하게 수행한다.
- schema migration은 v0.1 범위가 아니다. schemaVersion != 1은 validation error다.
```


### 17.2 v0.2 workload별 매핑

v0.2에서는 workload별 source mapping을 저장한다.

```json
{
  "workloadMappings": [
    {
      "context": "dev-cluster",
      "namespace": "backend",
      "kind": "Deployment",
      "name": "api-server",
      "sources": {
        "app": {
          "label": "APP",
          "container": "app",
          "filePath": "/var/log/app/info.log"
        },
        "access": {
          "label": "ACC",
          "container": "app",
          "filePath": "/var/log/app/access.log"
        },
        "error": {
          "label": "ERR",
          "container": "app",
          "filePath": "/var/log/app/error.log"
        }
      }
    }
  ]
}
```

---

## 18. UI 설계

### 18.1 메인 화면

```text
┌────────────────────────────────────────────────────────────────────┐
│ klogcat                                                            │
│ Context [dev]  Namespace [backend]  Pod [api-server-7d9f8c]         │
│ Log [APP | ACC | ERR] selected: ACC                                │
│ Grep [ OpenTabMigrationFailedException ]                            │
│ [Start] [Stop] [Pause] [Clear] [Auto-scroll] [Wrap]                 │
├────────────────────────────────────────────────────────────────────┤
│ 09:20:04.227 ACC 500 POST /data/internal/open-tab/migration 11908ms │
│              OpenTabMigrationFailedException rcode=5000999 trId=... │
│ 09:20:05.104 ACC 200 GET /data/internal/open-tab/status 34ms        │
│              rcode=0 trId=open-tab-status-go_25007...              │
└────────────────────────────────────────────────────────────────────┘
```

v0.1 화면 예시는 단일 source만 표시한다. APP/ACC/ERR control은 segmented single-select이며, 동시에 여러 source row가 섞이지 않는다.

### 18.2 메인 UI에서 숨길 것

메인 화면에는 아래를 직접 노출하지 않는다.

```text
- tail command
- filePath
- detailed source mapping
- raw JSON full body
```

단, tooltip이나 settings에서는 보여줄 수 있다.

예:

```text
APP → /var/log/app/info.log
ACC → /var/log/app/access.log
ERR → /var/log/app/error.log
```

### 18.3 로그 row 기본 정책

```text
- 고정폭 폰트
- 고밀도 row
- wrap off by default
- 긴 trId/url/reason은 truncate
- raw JSON은 필요 시 copy 또는 detail에서 확인
```

기본 표시:

```text
time | sourceType | jsonLogType/status | method | path/url | elapsed | summary | trId
```

### 18.4 v0.1 source selection policy

v0.1에서는 active source가 항상 하나다.

```text
activeSourceType: 'app' | 'access' | 'error'
```

source type을 변경하면:

```text
1. 실행 중인 stream이 있으면 stop한다.
2. ring buffer와 visible list를 clear한다.
3. streamStatus를 idle 또는 stopped로 둔다.
4. 사용자가 다시 Start를 눌러야 새 source mapping으로 stream을 시작한다.
```

namespace 또는 pod 변경도 동일하다. v0.1에서는 선택 변경에 따른 자동 재시작을 지원하지 않는다.

APP/ACC/ERR UI는 multi-select가 아니라 single-select segmented control이다.


### 18.5 v0.1 Settings modal

v0.1은 source mapping 수정을 위한 Settings modal을 제공한다.

필드:

```text
- APP/ACC/ERR 각각의 container
- APP/ACC/ERR 각각의 filePath
- initialTailLines
- bufferLimit
```

저장 시 validation을 수행하고, 실패하면 설정을 저장하지 않는다.

---

## 19. Process Lifecycle

tail process 상태:

```ts
type StreamStatus =
  | 'idle'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'stopped'
  | 'error'
```

Pause는 stream status가 아니다.

```ts
type ViewerState = {
  activeStreamId?: string
  streamStatus: StreamStatus
  viewerPaused: boolean
}
```

### 19.1 필수 lifecycle 규칙

```text
- namespace 변경 시 기존 tail process를 종료하고 buffer를 clear한다.
- pod 변경 시 기존 tail process를 종료하고 buffer를 clear한다.
- log type 변경 시 기존 tail process를 종료하고 buffer를 clear한다.
- namespace/pod/log type 변경 후에는 자동 재시작하지 않는다. 사용자가 다시 Start를 눌러야 한다.
- 앱 종료 시 모든 child process 종료를 요청하고 가능한 경우 wait한다.
- 같은 source에 대해 중복 tail process 실행 금지
- v0.1은 frontend와 backend 모두 active stream을 최대 1개만 허용한다.
- backend startLogStream은 active stream이 이미 있으면 reject한다.
- stopAllLogStreams는 앱 종료/cleanup용이며, v0.1에서는 최대 1개 active stream을 정리한다.
- stderr line은 latest warning 또는 diagnostic으로 표시한다.
- stderr line만으로 streamStatus를 error로 전환하지 않는다.
- requested stop으로 발생한 process exit은 error가 아니다.
- requested stop이 아닌 process non-zero exit은 streamStatus = error로 처리한다.
- stream stop 중 도착한 stale event는 UI에 반영하지 않는다.
- v0.1은 stream disconnected/pod restarted 시 자동 reconnect하지 않는다.
- process 비정상 종료 후 사용자가 다시 Start할 수 있어야 한다.
```

### 19.2 v0.2 multi-source

v0.2에서는 source별 stream status를 표시한다.

예:

```text
APP api-server-1 running
ACC api-server-1 running
ERR api-server-1 error: log file not found
```

### 19.3 Stream identity and stale events

stream 시작 시 frontend는 새 `streamId`를 생성하고, `startLogStream` 호출 전에 `activeStreamId = streamId`, `streamStatus = starting`으로 설정한다.
모든 stream event는 `streamId`를 포함한다.

```text
frontend는 event.streamId !== activeStreamId인 event를 stale event로 보고 무시한다.
startLogStream reject 시 frontend는 activeStreamId가 여전히 해당 streamId일 때만 activeStreamId를 clear하고 streamStatus = error로 전환한다.
log://started 수신과 startLogStream resolve는 순서가 바뀌거나 중복 처리되어도 running 전환을 idempotent하게 수행한다.
```

이 정책은 namespace/pod/source 변경 중 이전 process에서 늦게 도착한 stdout이 새 화면에 섞이는 것을 방지한다.

---

## 20. Process Safety

`kubectl exec tail` 명령은 절대 shell string으로 만들지 않는다.

### 20.1 금지

```rust
Command::new("sh")
    .arg("-c")
    .arg(format!(
        "kubectl exec -n {} {} -c {} -- tail -F {}",
        namespace, pod, container, file_path
    ))
```

### 20.2 필수 방식

항상 argv 기반 process spawning을 사용한다.

```rust
Command::new("kubectl")
    .args([
        "exec",
        "-n",
        namespace,
        pod,
        "-c",
        container,
        "--",
        "tail",
        "-n",
        initial_tail_lines,
        "-F",
        file_path,
    ])
```

`initialTailLines`는 spawn 전에 string으로 변환한다.
shell escaping을 직접 수행하지 않는다.

### 20.3 설정값 validation

source mapping 값은 실행 전 검증한다.

```text
- filePath는 absolute path여야 한다.
- filePath는 비어 있으면 안 된다.
- filePath에는 null byte가 있으면 안 된다.
- container는 비어 있으면 안 된다.
- namespace/pod는 Kubernetes discovery 결과 또는 Kubernetes name 규칙을 통과해야 한다.
- initialTailLines는 0 이상 100000 이하 integer여야 한다.
- bufferLimit은 1000 이상 200000 이하 integer여야 한다.
```

---

## 21. 에러 처리

### 21.1 에러 범주

v0.1 에러는 UI 상태와 처리 위치에 따라 분리한다.

```text
Bootstrap errors:
- kubectl not found
- kubeconfig/context not found

Discovery errors:
- namespace list failed
- pod list failed

Settings errors:
- settings file read failed
- settings JSON parse failed
- settings validation failed
- settings save failed

Stream start errors:
- pod not found
- container not found
- kubectl exec forbidden / RBAC pods/exec denied
- process spawn failed

Runtime stream errors:
- requestedStop이 아닌 non-zero process exit
- stream disconnected
- pod restarted

Non-fatal line diagnostics:
- JSON parse failed
- unknown JSON schema
- missing optional fields
```

### 21.2 UI 표시 원칙

```text
- Bootstrap/discovery/settings error는 banner 또는 blocking state로 표시한다.
- Stream start error는 Start 버튼 주변 또는 stream status 영역에 표시한다.
- Runtime stream error는 streamStatus = error와 함께 표시한다.
- Non-fatal line diagnostics는 row-level diagnostics 또는 diagnostic counter로 표시한다.
- 사용자가 조치 가능한 메시지를 우선한다.
```

### 21.3 Fatal stream errors

아래는 startLogStream command reject 또는 streamStatus를 `error`로 전환하는 fatal stream error다.
Start validation/spawn 단계의 오류는 command reject로 전달하며, 중복 `log://error` event를 emit하지 않는다. spawn 이후 runtime 오류만 `log://exit` 또는 `log://error` event로 전달한다.

```text
- startLogStream spawn 실패
- kubectl exec 시작 실패
- pod not found
- container not found
- kubectl exec forbidden / RBAC pods/exec denied
- requestedStop이 아닌 non-zero process exit
- requestedStop이 아닌 stream disconnected
- pod restarted로 판단되는 runtime disconnect
```

아래는 stderr에 나타나더라도 stderr line만으로 즉시 fatal 처리하지 않는다.

```text
- tail command not found
- tail -F unsupported
- log file not found
- permission denied reading log file
```

이들은 process가 non-zero로 종료되면 fatal로 처리한다. process가 계속 살아 있으면 latest warning/diagnostic으로 표시한다.

### 21.4 Non-fatal line handling

아래는 line-level non-fatal error다.

```text
- JSON parse failed
- field missing
- unexpected field type
- unsupported logType value
```

이 경우:

```text
- raw line은 버리지 않는다.
- JSON.parse 실패는 parseStatus = 'raw'로 표시한다.
- JSON.parse 성공 후 field missing/unexpected type은 parseStatus = 'parsed'로 유지한다.
- 필요한 경우 row-level diagnostics 또는 diagnostic counter로 표시한다.
- grep/search 대상에는 raw line을 포함한다.
- stream은 계속 유지한다.
```

### 21.5 stderr handling

`kubectl exec`와 `tail -F`는 stderr에 diagnostic을 출력할 수 있다.

정책:

```text
- stderr line은 log://stderr event로 frontend에 전달한다.
- stderr line은 로그 row로 섞지 않는다.
- UI는 latest stderr warning을 stream status 영역에 표시할 수 있다.
- stderr line만으로 fatal 처리하지 않는다.
- requestedStop이 아닌 process non-zero exit code는 fatal stream error로 처리한다.
- kubectl spawn 실패, exec forbidden 등 process start 실패는 fatal error다.
- tail -F가 stderr를 출력하지만 계속 실행 중이면 warning 상태를 유지한다.
```

---

## 22. Tauri Command and Event Contract

v0.1 frontend/backend boundary는 아래 contract를 기준으로 구현한다. 이름은 TypeScript style로 표기하지만 Rust command는 snake_case로 매핑할 수 있다.

commands:

```text
- getCurrentContext(): string
- listNamespaces(): ListNamespacesResponse
- listPods(namespace: string): ListPodsResponse
- getSettings(): GetSettingsResponse
- saveSettings(settings: PersistedSettings): PersistedSettings
- resetSettings(): PersistedSettings
- startLogStream(request: StartLogStreamRequest): void
- stopLogStream(streamId: string): void
- stopAllLogStreams(): void
```

command semantics:

```text
- getSettings는 settings 파일이 없으면 default settings를 생성/저장한 뒤 success로 반환한다.
- getSettings는 파일 읽기/JSON parse 실패 시 default settings와 runtime-only warning을 반환한다.
- 파일 읽기/JSON parse 실패가 난 기존 파일은 자동 overwrite하지 않는다.
- getSettings는 validation 실패 시 default settings를 반환하지 않고 SettingsValidationError[] 또는 SettingsLoadError로 reject한다.
- warning은 저장 파일에 포함하지 않으며 GetSettingsResponse에만 존재한다.
- saveSettings는 PersistedSettings만 입력받아 warning을 무시/저장하지 못하게 한다.
- saveSettings는 validation 성공 후 저장하고, 저장된 normalized settings를 반환한다.
- saveSettings는 validation 실패 시 reject하며 파일을 변경하지 않는다.
- resetSettings는 default settings를 파일에 저장하고 반환한다.
- startLogStream은 Start validation/spawn 실패 시 command를 reject하며 중복 log://error를 emit하지 않는다.
- startLogStream은 child process spawn 성공 시 resolve하고, 이후 runtime error는 log://exit 또는 log://error event로 전달한다.
- startLogStream resolve 또는 log://started 수신 후 frontend는 idempotent하게 streamStatus = running으로 전환한다.
- stopLogStream은 requestedStop = true를 먼저 설정하고 child process 종료 요청 후 wait까지 완료하면 resolve한다.
- stopAllLogStreams는 모든 active stream에 대해 requested stop을 수행한다.
```

types:

```ts
type SourceLogType = 'app' | 'access' | 'error'

type NamespaceInfo = {
  name: string
}

type PodPhase = 'Pending' | 'Running' | 'Succeeded' | 'Failed' | 'Unknown'

type PodInfo = {
  name: string
  namespace: string
  phase: PodPhase
  containers: string[]
}

type ListNamespacesResponse = {
  namespaces: NamespaceInfo[]
}

type ListPodsResponse = {
  namespace: string
  pods: PodInfo[]
}

type SettingsWarning = {
  code: 'read_failed' | 'parse_failed'
  message: string
  details?: string
}

type GetSettingsResponse = {
  settings: PersistedSettings
  warning?: SettingsWarning
}

type PersistedSettings = {
  schemaVersion: 1
  defaultNamespace?: string
  initialTailLines: number
  bufferLimit: number
  logSources: Record<SourceLogType, LogSourceConfig>
}

type LogSourceConfig = {
  container: string
  filePath: string
}

type SettingsValidationError = {
  field: string
  message: string
}

type SettingsLoadError = {
  code: 'validation_failed'
  message: string
  details?: string
  validationErrors?: SettingsValidationError[]
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
  raw: string
  receivedAt: number
}

type LogStreamStartedEvent = {
  streamId: string
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
  requestedStop: boolean
}

type LogStreamErrorEvent = {
  streamId?: string
  code: string
  message: string
  details?: string
}
```

events:

```text
- log://started
- log://line
- log://stderr
- log://exit
- log://error
```

stream lifecycle:

```text
1. Frontend generates streamId.
2. Frontend sets activeStreamId = streamId and streamStatus = starting before invoking startLogStream(request).
3. Backend rejects startLogStream if another active stream already exists.
4. Backend stores stream process under streamId only after spawn success.
5. Start validation/spawn failure rejects command and does not emit duplicate log://error.
6. startLogStream resolves and/or backend emits log://started; frontend running transition is idempotent.
7. Backend emits log://line and log://stderr with the same streamId.
8. Backend assigns receivedAt when stdout/stderr line is completed, before emitting event.
9. stopLogStream(streamId) marks requestedStop = true before terminating the process.
10. Backend emits log://exit with requestedStop = true when stop completes.
11. Frontend ignores events whose streamId != activeStreamId.
```

exit handling:

```text
- requestedStop = true인 log://exit는 정상 종료로 처리한다.
- requestedStop = false이고 exitCode가 0이 아니면 streamStatus = error로 처리한다.
- requestedStop = false이고 exitCode가 없거나 signal이 있으면 stream disconnected로 처리한다.
```

stop/kill policy:

```text
- stopLogStream/stopAllLogStreams는 terminate 전에 requestedStop = true를 먼저 기록한다.
- 정상 종료를 최대 3초까지 wait한다.
- 3초 내 종료되지 않으면 가능한 경우 한 번 더 terminate 또는 force kill을 시도한다.
- requestedStop = true 이후 발생한 exit는 fatal stream error로 처리하지 않는다.
```

---

## 23. 기술 스택

권장 스택:

```text
Desktop shell: Tauri
Frontend: React + TypeScript
Styling: Tailwind CSS
State: Zustand
Virtual list: @tanstack/react-virtual
Backend: Tauri Rust commands
Log source: kubectl exec ... tail -F
```

### 23.1 파싱 위치

v0.1에서는 TypeScript에서 JSON parsing을 수행한다.

역할 분리:

```text
Rust:
- kubectl exec tail process 관리
- stdout/stderr streaming
- process cleanup

TypeScript:
- JSON.parse
- ACC/ERR/APP summary 생성
- grep
- render
```

성능 문제가 생기면 v0.2에서 parser를 Web Worker로 이동할 수 있다.

---

## 24. 아키텍처

```text
React UI
  ↓
User selects namespace / pod / source type
  ↓
Tauri command
  ↓
Rust process manager
  ↓
kubectl exec -n <ns> <pod> -c <container> -- tail -n <N> -F <file>
  ↓
stdout line stream
  ↓
Tauri event emit
  ↓
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

## 25. 초기 파일 구조

```text
klogcat/
  README.md
  package.json
  src/
    main.tsx
    App.tsx
    components/
      AppShell.tsx
      TopBar.tsx
      LogTypeSelector.tsx
      GrepBar.tsx
      LogToolbar.tsx
      LogViewer.tsx
      LogRow.tsx
    commands/
      tauriKube.ts
      tauriLogs.ts
    config/
      defaultSettings.ts
      validateSettings.ts
    stores/
      logStore.ts
      kubeStore.ts
      settingsStore.ts
    types/
      log.ts
      kube.ts
      settings.ts
    utils/
      parseLogLine.ts
      parseAccessLog.ts
      parseErrorLog.ts
      parseAppLog.ts
      ringBuffer.ts
      grep.ts
      highlight.tsx
      formatTime.ts
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
      main.rs
      commands/
        kube.rs
        logs.rs
      process/
        log_process.rs
        line_splitter.rs
      settings/
        mod.rs
    tauri.conf.json
  docs/
    DESIGN.md
```

---

## 26. Version Scope

`klogcat`은 v0.2에서 기능적으로 완성된다.

```text
v0.1 = Single Pod Tail JSON Logcat
v0.2 = Complete Tail JSON Logcat
v0.3 = 없음
```

v0.2 이후에는 다음에 집중한다.

```text
- bug fixes
- performance improvement
- packaging
- UI polish
- reliability
```

새로운 기능 영역은 추가하지 않는다.

---

## 27. v0.1 Scope

### 27.1 목표

```text
단일 pod 내부의 APP/ACC/ERR 로그 파일 중 하나를 tail -F로 실시간 추적하고,
JSON Lines를 읽기 쉬운 row로 표시하며,
raw grep을 제공한다.
```

### 27.2 필수 기능

```text
- Tauri + React + TypeScript 프로젝트
- 현재 kube context 사용
- current context 표시
- namespace 목록 조회
- pod 목록 조회
- APP/ACC/ERR 단일 선택
- log source mapping:
  - source type
  - container
  - filePath
- settings load/save persistence
- Settings modal
- kubectl exec tail -n <N> -F 기반 stream
- Start/Stop stream control
- streamId 기반 stale event discard
- stdout line splitting
- initialTailLines 기본값 200
- JSON Lines best-effort parsing
- ACC summary rendering
- ERR summary rendering
- APP generic rendering
- raw fallback
- raw line 기준 grep
- grep 변경 시 stream 재시작 없음
- ring buffer
- parser unit fixtures
- line splitter unit tests
- settings unit tests
- stream event unit tests
- mocked kubectl/process tests
- source mapping validation
- pause / resume
- clear logs
- auto-scroll
- process cleanup
- stream error display
```

### 27.3 v0.1 polish

있으면 좋지만 필수는 아니다.

```text
- precise match highlight
- line wrap toggle
- keyboard shortcuts
- copy raw line
- container list auto-discovery
```

### 27.4 v0.1 제외

```text
- kubectl logs -f
- container stdout/stderr log viewer
- multi-pod tail
- multi-log-type tail
- deployment selection
- regex search
- case sensitive search
- invert match
- structured query language
- Loki / DB 연동
- previous logs 조회
- since query
- automatic reconnect
- kube context switching
- simultaneous APP/ACC/ERR tail
- settings sync/cloud persistence
```

---

## 28. v0.2 Scope

### 28.1 목표

```text
deployment 또는 여러 pod의 APP/ACC/ERR 로그 파일을 동시에 tail하고,
고급 grep과 quick filter를 제공한다.
```

### 28.2 필수 기능

```text
- Deployment 선택
- Deployment에 속한 pod 전체 tail
- multi-pod tail
- APP/ACC/ERR multi-source tail
- workload별 source mapping 저장
- regex search
- case sensitive toggle
- invert match
- recent search history
- copy visible logs
- save visible logs
- trId / traceId quick filter
- copy trId / traceId
- ACC status color
- ACC elapsed color
- source별 stream status 표시
- arrival-order rendering for multi-source streams
```

### 28.3 v0.2 optional

```text
- simple multiline handling if real logs require it
- parser Web Worker if performance requires it
```

### 28.4 v0.2 제외

```text
- previous logs
- since 10m / since 1h
- full structured query language
- full access log parser framework
- language-specific stack trace parser
- Loki
- Elasticsearch
- DB 저장
- metrics
- alerts
- tracing
- AI analysis
```

---

## 29. v0.1 Test Plan

v0.1 구현은 아래 테스트를 최소 기준으로 삼는다.

```text
Line splitter tests:
- partial line across chunks
- multiple lines in one chunk
- CRLF handling: `a\r\nb\r\n` 입력은 `a`, `b`를 emit하고 trailing CR(0x0D)을 제거한다.
- no trailing newline flush on process exit
- UTF-8 multibyte boundary split

Parser tests:
- valid ACC JSON
- valid ERR JSON
- APP JSON with message
- APP JSON with body string
- APP JSON with body object
- invalid JSON raw fallback
- ACC status string/number
- ERR errors empty array
- ERR without body.errorDetails

Grep tests:
- case-insensitive match
- trim query
- empty query returns all lines
- raw-only match keeps row visible

Ring buffer tests:
- overflow drops oldest lines
- clear empties buffer and visible list
- clear does not reset line id counter
- pause overflow updates dropped count

Settings tests:
- default generation
- missing file creates default settings
- invalid JSON fallback with warning and does not overwrite invalid file
- validation failure rejects getSettings/saveSettings as specified
- uppercase APP/ACC/ERR logSources keys are invalid
- extra keys are rejected
- save/load roundtrip

Stream event tests:
- stale streamId discard
- requestedStop exit is not error
- stderr diagnostic does not become fatal by itself
- non-zero exit without requestedStop becomes error

Mocked kubectl/process tests:
- namespace list success/failure
- pod list success/failure
- exec emits stdout chunks
- exec emits stderr then exits non-zero
```

---

## 30. 성공 기준

### 30.1 v0.1 성공 기준

v0.1은 아래가 가능하면 성공이다.

```text
1. 사용자가 namespace를 선택할 수 있다.
2. 사용자가 pod를 선택할 수 있다.
3. 사용자가 APP/ACC/ERR 중 하나를 선택할 수 있다.
4. klogcat이 pod 내부 로그 파일을 tail -F로 실시간 추적한다.
5. ACC JSON log가 읽기 쉬운 row로 표시된다.
6. ERR JSON log가 읽기 쉬운 row로 표시된다.
7. 검색어 입력 시 raw line 기준으로 즉시 grep된다.
8. 검색어 변경 시 tail process를 재시작하지 않는다.
9. Pause / Resume이 동작한다.
10. Clear가 동작한다.
11. 앱 종료 시 tail process가 정리된다.
12. stdout chunk가 line 단위로 안정적으로 분리된다.
13. source/pod 변경 중 stale event가 새 화면에 섞이지 않는다.
14. invalid JSON line은 stream error가 아니라 raw row로 표시된다.
15. kubectl/tail/process error가 stream status area에 표시된다.
16. 설정값 validation이 동작한다.
17. parser/grep/ring buffer unit test가 통과한다.
18. line splitter/settings/stream event test가 통과한다.
19. requested stop exit과 non-zero runtime exit이 구분된다.
```

### 30.2 v0.2 성공 기준

v0.2는 아래가 가능하면 완성이다.

```text
1. 사용자가 Deployment를 선택할 수 있다.
2. Deployment에 속한 여러 pod를 동시에 tail할 수 있다.
3. APP/ACC/ERR 로그를 동시에 볼 수 있다.
4. regex / case sensitive / invert match가 동작한다.
5. trId / traceId quick filter가 동작한다.
6. visible logs를 copy/save할 수 있다.
7. ACC status/elapsed 색상이 표시된다.
8. source별 stream 상태가 표시된다.
9. 다중 source 로그가 arrival order로 안정적으로 표시된다.
10. workload별 source mapping이 저장된다.
```

---

## 31. 최종 제품 문장

```text
klogcat is a tail-based Kubernetes desktop GUI for APP, ACC, and ERR server log files.
It uses `kubectl exec ... tail -n <N> -F <file>` to stream log files inside pods,
parses JSON Lines best-effort, and provides Android Logcat-style real-time grep.

klogcat is not a `kubectl logs -f` viewer and does not target container stdout logs.
```

한국어:

```text
klogcat은 Kubernetes pod 내부의 APP, ACC, ERR 서버 로그 파일을 대상으로 하는
tail 기반 데스크톱 GUI다. `kubectl exec ... tail -n <N> -F <file>`로 로그 파일을
실시간 추적하고, JSON Lines를 best-effort로 파싱하며, Android Logcat처럼
실시간 grep을 제공한다.

klogcat은 `kubectl logs -f` 기반 stdout 로그 뷰어가 아니다.
```
