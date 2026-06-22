# klogcat

Tauri + React desktop log tailer for Kubernetes pod log files.

## Install from GitHub

Debian/Ubuntu Linux에서 처음 빌드한다면 먼저 native dependency를 설치하세요:

```bash
sudo apt-get update
sudo apt-get install -y pkg-config libdbus-1-dev libglib2.0-dev
```

`gio-sys` 에러가 `gio-2.0 >= 2.70`라면 Ubuntu 20.04 / Debian 11 계열은 GLib/GIO가 낮을 수 있습니다. Ubuntu 22.04+ / Debian 12+를 권장합니다.

그 다음:

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
