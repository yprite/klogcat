# Rubber Duck Bug Audit

## KLOG-BUG-001

- ID: KLOG-BUG-001
- 제목: Failed Requests view loses correlated access evidence after query filtering
- 심각도: Major
- 발견 위치: `src/components/FailedRequestsView.tsx`
- 사용자 흐름: 사용자가 raw log에서 `boom`, exception name, status, trId 같은 query로 좁힌 뒤 Failed Requests 탭으로 이동한다.
- 재현 절차:
  1. 같은 `trId`를 가진 access 5xx row와 error row를 store에 적재한다.
  2. query 결과가 error row만 남은 상태처럼 `visibleRows`를 error row로 제한한다.
  3. Failed Requests view를 렌더링한다.
- 기대 동작: query가 특정 evidence row만 남겨도 같은 correlation group의 access row, status, raw evidence count는 보존되어야 한다.
- 실제 동작: Failed Requests view가 `visibleRows`만 grouping해서 access row를 잃고, status가 `ERR`로 떨어지며 raw evidence count가 1로 줄어든다.
- 원인 분석: `FailedRequestsView`가 전체 `rows`가 아니라 grep/query가 적용된 `visibleRows`만 `groupFailedRequestsFromPolicy`에 전달한다.
- 영향 범위: 실패 요청 조사 모드에서 status code, request title, raw evidence count가 query 상태에 따라 불완전하게 표시된다.
- 수정 방향: 전체 `rows`로 correlation group을 만든 뒤, query가 있으면 `visibleRows`와 교차하는 group만 표시한다. 이렇게 하면 query focus는 유지하면서 group evidence는 보존된다.
- 추가/수정할 테스트: `FailedRequestsView.test.tsx`에 query-filtered visible rows가 full correlated evidence를 보존하는 테스트를 추가한다.
- 회귀 방지 포인트: Failed Requests view는 raw/source rows를 대체하지 않고 correlation evidence를 보존해야 한다.

## KLOG-BUG-002

- ID: KLOG-BUG-002
- 제목: Scoped namespace selection can leave selectedContext and selectedNamespace inconsistent
- 심각도: Major
- 발견 위치: `src/stores/kubeStore.ts`
- 사용자 흐름: 사용자가 Target Picker에서 여러 context를 보고, 현재 대표 context와 다른 context의 namespace를 선택한다.
- 재현 절차:
  1. `selectedContext`가 `ctx`인 상태에서 `cluster-a/prod` namespace를 선택한다.
  2. `selectNamespaces([scopeKey('cluster-a', 'prod')])`를 호출한다.
  3. store의 `selectedContext`, `selectedNamespace`, `namespaces`, `pods`를 확인한다.
- 기대 동작: 대표 `selectedContext`도 첫 scoped namespace의 context인 `cluster-a`로 맞춰져야 한다.
- 실제 동작: `selectedContext`는 이전 값 `ctx`로 남고 `selectedNamespace`만 `prod`가 되어 `ctx/prod` 같은 불가능한 대표 선택 상태가 생긴다.
- 원인 분석: `selectNamespaces`가 scoped namespace 값에서 `firstContext`를 계산하지만 state에 `selectedContext`와 대표 `namespaces`를 갱신하지 않는다.
- 영향 범위: 이후 target refresh, default selected scope, 대표 namespace/pod 표시, Start 전 대상 해석에서 stale 또는 비어 있는 pods가 보일 수 있다.
- 수정 방향: namespace 선택 시 첫 scoped context를 대표 `selectedContext`로 반영하고, 해당 context의 namespace 목록도 대표 `namespaces`에 맞춘다.
- 추가/수정할 테스트: `kubeStore.test.ts`에 cross-context namespace selection이 representative context를 함께 갱신하는 테스트를 추가한다.
- 회귀 방지 포인트: `selectedContext`와 `selectedNamespace`는 항상 같은 scoped namespace에서 나온 대표값이어야 한다.

## KLOG-BUG-003

- ID: KLOG-BUG-003
- 제목: Start can launch a stream for a Running pod with no containers
- 심각도: Major
- 발견 위치: `src/components/LogToolbar.tsx`
- 사용자 흐름: 사용자가 Target Picker에서 Running pod를 선택하고 Start를 누른다.
- 재현 절차:
  1. 선택된 target pod의 `phase`는 `Running`이지만 `containers`가 빈 배열인 상태를 만든다.
  2. Start 버튼을 누른다.
  3. `startLogStream` 호출 여부와 error banner state를 확인한다.
- 기대 동작: 선택된 pod에 container가 없으면 stream을 시작하지 않고 사용자에게 container가 없다는 이유를 보여줘야 한다.
- 실제 동작: 차단 조건이 phase만 확인해서 `containers=[]`인 pod에도 settings 기본 container(`app`)로 stream start를 시도한다.
- 원인 분석: `invalidTargets`가 `t.pod.phase !== 'Running'`만 검사하고 `t.pod.containers.length === 0`을 검사하지 않는다.
- 영향 범위: Kubernetes API가 불완전하거나 cached/fallback target에 container 정보가 없을 때 불필요한 `kubectl exec -c app` 실패가 발생한다.
- 수정 방향: Start disabled/rejected reason 계산에서 Running phase와 container 존재 여부를 함께 검증한다.
- 추가/수정할 테스트: `buttonActions.test.tsx`에 container가 없는 Running pod에서는 `startLogStream`을 호출하지 않는 테스트를 추가한다.
- 회귀 방지 포인트: container 정보가 없으면 default container fallback을 사용하지 않는다. fallback은 pod가 실제 container 목록을 제공할 때만 적용한다.

## KLOG-BUG-004

- ID: KLOG-BUG-004
- 제목: Query validator accepts out-of-order parentheses
- 심각도: Minor
- 발견 위치: `src/utils/logQuery.ts`
- 사용자 흐름: 사용자가 Query 입력창에 `)(` 또는 `status:500 ) (` 같은 잘못된 괄호 입력을 넣는다.
- 재현 절차:
  1. `validateLogQuery(')(')`를 호출한다.
  2. `matchesLogQuery(row, ')(')`를 호출한다.
- 기대 동작: 닫는 괄호가 여는 괄호보다 먼저 나오면 query가 invalid로 표시되어야 하고, matcher도 malformed query를 match-all로 처리하지 않아야 한다.
- 실제 동작: validation은 최종 괄호 balance만 확인해서 `)(`를 valid로 처리한다. matcher는 parse 실패 시 `true`를 반환해 모든 row가 보일 수 있다.
- 원인 분석: `validateLogQuery`가 토큰 순서별 depth를 확인하지 않고 최종 합계만 검사한다. `matchesLogQuery`도 validation을 거치지 않는다.
- 영향 범위: 잘못된 query 입력이 정상처럼 보이고, 사용자는 필터가 적용된 줄 알지만 결과가 match-all로 유지될 수 있다.
- 수정 방향: 괄호 depth가 중간에 음수가 되는 입력을 invalid로 처리하고, `matchesLogQuery`도 invalid query면 false를 반환한다.
- 추가/수정할 테스트: `logQuery.test.ts`에 out-of-order parentheses validation과 malformed query match 방지 테스트를 추가한다.
- 회귀 방지 포인트: validation과 matcher의 malformed query 처리를 동일하게 유지한다.

## KLOG-BUG-005

- ID: KLOG-BUG-005
- 제목: Query parser silently ignores dangling boolean operators
- 심각도: Minor
- 발견 위치: `src/utils/logQuery.ts`
- 사용자 흐름: 사용자가 Query 입력창에 `status:500 |` 또는 `| status:500`처럼 불완전한 boolean query를 입력한다.
- 재현 절차:
  1. `validateLogQuery('status:500 |')`를 호출한다.
  2. `matchesLogQuery(row, 'status:500 |')`를 호출한다.
- 기대 동작: trailing/leading boolean operator나 bare `!`는 invalid로 표시되어야 하고 matcher도 조용히 앞 조건만 적용하지 않아야 한다.
- 실제 동작: parser가 오른쪽 expression이 없으면 loop를 중단하고 왼쪽 expression만 반환해서 `status:500 |`가 `status:500`처럼 동작한다.
- 원인 분석: validation이 token placement를 검사하지 않고 regex/parentheses만 확인한다. parser도 모든 token이 소비됐는지 검증하지 않는다.
- 영향 범위: 사용자가 불완전한 query를 입력했을 때 필터가 의도와 다르게 부분 적용된다.
- 수정 방향: validation에서 operand/operator 순서를 검사하고, matcher는 invalid query를 false로 처리한다.
- 추가/수정할 테스트: `logQuery.test.ts`에 dangling/leading operator와 bare NOT query 테스트를 추가한다.
- 회귀 방지 포인트: `|`, `&`, `!`는 완전한 expression 안에서만 허용한다.
