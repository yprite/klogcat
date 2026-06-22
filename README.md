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

For full prerequisites and install alternatives, see [docs/INSTALL.md](docs/INSTALL.md).

## Tauri build and runtime flow

`klogcat` is distributed as an npm-style launcher, but the desktop app is still a native Tauri binary.

- `npm install -g git+ssh://git@github.com/yprite/klogcat.git` installs the source package and the `klogcat` CLI wrapper.
- First `klogcat` launch checks for `src-tauri/target/release/klogcat`.
- If the binary is missing, the wrapper runs:

```bash
npm run tauri build -- --no-bundle
```

- The production binary is then launched from:

```text
src-tauri/target/release/klogcat
```

Useful wrapper commands:

```bash
klogcat              # build if needed, then launch
klogcat --build-only # build the Tauri binary and exit
klogcat --dev        # run Tauri dev mode
klogcat --no-build   # launch existing binary only
klogcat --help       # show dependency/build notes
```

## Tauri configuration

Main Tauri settings live in [`src-tauri/tauri.conf.json`](src-tauri/tauri.conf.json):

- `productName`: `klogcat`
- `version`: `0.1.0`
- `identifier`: `com.klogcat.app`
- `beforeDevCommand`: `npm run dev`
- `devUrl`: `http://localhost:1420`
- `beforeBuildCommand`: `npm run build`
- `frontendDist`: `../dist`
- Default window: `1200x800`, title `klogcat`
- Bundle setting: `active: true`, `targets: all`

The npm scripts mirror this flow:

```bash
npm run tauri       # pass-through to Tauri CLI
npm run klogcat:dev # node ./bin/klogcat.js --dev
npm run klogcat:build # node ./bin/klogcat.js --build-only
npm start           # node ./bin/klogcat.js
```

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
