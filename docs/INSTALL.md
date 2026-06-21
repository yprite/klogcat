# klogcat install

klogcat is a Tauri desktop app. The repo can be installed in an npm-like way from GitHub, but the first launch still needs local build tools because the native app binary is compiled on your machine.

## Prerequisites

macOS:

```bash
brew install node rust
xcode-select --install
```

Also required at runtime:

```bash
kubectl version --client
```

## Option A: install globally from GitHub

```bash
npm install -g git+ssh://git@github.com/yprite/klogcat.git
klogcat
```

The first `klogcat` run builds the release binary with:

```bash
npm run tauri build -- --no-bundle
```

Then it launches:

```text
src-tauri/target/release/klogcat
```

Useful commands:

```bash
klogcat --build-only
klogcat --dev
klogcat --no-build
klogcat --help
```

## Option B: clone and run

```bash
git clone git@github.com:yprite/klogcat.git
cd klogcat
npm install
npm run klogcat:build
npm start
```

## Option C: build a local macOS app bundle

```bash
npm run tauri build
```

The app bundle/installer artifacts are created under:

```text
src-tauri/target/release/bundle/
```

## Notes

- `npm install` installs JavaScript dependencies only.
- `npm install -g git+ssh://...` plus the `klogcat` command gives a CLI-style install flow.
- A polished end-user distribution should eventually use GitHub Releases with signed `.dmg`/`.app` artifacts or Homebrew Cask.
