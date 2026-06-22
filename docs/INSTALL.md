# klogcat install

klogcat is a Tauri desktop app. The repo can be installed in an npm-like way from GitHub, but the first launch still needs local build tools because the native app binary is compiled on your machine.

## Prerequisites

macOS:

```bash
brew install node rust
xcode-select --install
```

Debian/Ubuntu Linux:

```bash
sudo apt-get update
sudo apt-get install -y nodejs npm cargo rustc pkg-config libdbus-1-dev libglib2.0-dev \
  libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev
```

`libdbus-1-dev` is required because Tauri's Linux dependency chain can build the Rust crate `libdbus-sys`.
Without it, `npm run tauri build` / first `klogcat` launch can fail while compiling `libdbus-sys v0.2.7`.

`libglib2.0-dev` is required because the Rust crate `gio-sys` needs `gio-2.0 >= 2.70` via `pkg-config`.
If the error still says `gio-2.0 >= 2.70` after installing `libglib2.0-dev`, the distro's GLib/GIO version is too old.
Use Ubuntu 22.04+ / Debian 12+, or install a newer GLib/GIO toolchain.

Fedora equivalent:

```bash
sudo dnf install nodejs npm cargo rust pkgconf-pkg-config dbus-devel glib2-devel \
  webkit2gtk4.1-devel gtk3-devel libappindicator-gtk3-devel librsvg2-devel
```

Arch equivalent:

```bash
sudo pacman -S nodejs npm rust pkgconf dbus glib2 webkit2gtk-4.1 gtk3 libayatana-appindicator librsvg
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
