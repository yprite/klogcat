# Live Kubernetes smoke testing

`npm run test:kube:live` is a read-only preflight smoke test for the local machine's real `kubectl` configuration. It verifies that the same Kubernetes access klogcat depends on is available before running UI/e2e flows. It does not create, patch, or delete Kubernetes objects.

## Default behavior

Without an explicit opt-in, the harness skips and prints a diagnostic skip reason:

```bash
npm run test:kube:live
# [live-kube-smoke] status=skipped reason=KLOGCAT_LIVE_KUBE_not_enabled
```

## Required environment

```bash
KLOGCAT_LIVE_KUBE=1 \
KLOGCAT_TEST_CONTEXT=<kubectl-context> \
KLOGCAT_TEST_NAMESPACE=<namespace> \
KLOGCAT_TEST_POD_SELECTOR='app=my-api' \
npm run test:kube:live
```

`KLOGCAT_TEST_CONTEXT` may be omitted to use `kubectl config current-context`.

Optional:

```bash
KLOGCAT_TEST_CONTAINER=<container-name>          # defaults to the first container in the selected Running pod
KLOGCAT_TEST_TIMEOUT_MS=30000                   # per-kubectl command timeout
KLOGCAT_LIVE_REQUIRE_LOG_LINE=1                 # fail if kubectl logs --tail=1 returns no line
KLOGCAT_KUBECTL_BIN=/path/to/kubectl            # override kubectl binary, useful for fixtures
```

## What it verifies

The harness writes `.harness/e2e-artifacts/<timestamp>-live-kube-smoke/summary.json` and `kubectl.log` with:

- `kubectl version --client`
- actual/current context resolution
- `kubectl auth can-i list namespaces` (diagnostic only; namespace-scoped users may still pass the smoke)
- `kubectl auth can-i list pods -n <namespace>`
- `kubectl auth can-i watch pods -n <namespace>` (diagnostic only; current smoke requires log attachment, not pod watches)
- `kubectl auth can-i get pods/log -n <namespace>`
- Running pod discovery via:
  ```bash
  kubectl get pods -n <namespace> -l <selector> --field-selector=status.phase=Running -o json
  ```
- real pod log attachment via:
  ```bash
  kubectl logs -n <namespace> <pod> -c <container> --tail=1
  ```

## Failure policy

- Missing `KLOGCAT_LIVE_KUBE=1`: skip with a clear reason.
- Missing namespace or selector: fail with the missing env names.
- `can-i list pods` is `no`: fail because target discovery cannot be trusted.
- `can-i get pods/log` is `no`: fail because log streaming is blocked by RBAC.
- No Running pod matches the selector: fail with namespace and selector details.
- Quiet pod logs are allowed by default. Set `KLOGCAT_LIVE_REQUIRE_LOG_LINE=1` to require an actual returned log line.

## Relation to live e2e

`npm run test:e2e:live-kubectl` creates a disposable namespace/pod and drives the browser UI. `npm run test:kube:live` instead uses an existing local kube context and existing pods, so it is the safer first smoke test for the user's real environment.
