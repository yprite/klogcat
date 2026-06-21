# klogcat

Tauri + React desktop log tailer for Kubernetes pod log files.

## Install from GitHub

```bash
npm install -g git+ssh://git@github.com/yprite/klogcat.git
klogcat
```

First launch builds the native Tauri binary locally.

For prerequisites and alternatives, see [docs/INSTALL.md](docs/INSTALL.md).

## Development

```bash
npm install
npm run tauri dev
```

## Quality gates

```bash
npm test
npm run build
cd src-tauri && cargo fmt -- --check && cargo test && cargo check
```
