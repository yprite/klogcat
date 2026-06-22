#!/usr/bin/env node
import { spawnSync, spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const binary = join(root, 'src-tauri', 'target', 'release', process.platform === 'win32' ? 'klogcat.exe' : 'klogcat');
const args = process.argv.slice(2);

function printHelp() {
  console.log(`klogcat

Usage:
  klogcat                 Build if needed, then launch the desktop app
  klogcat --build-only    Build the Tauri binary and exit
  klogcat --dev           Run Tauri dev mode
  klogcat --no-build      Launch existing binary only
  klogcat --help          Show this help

Notes:
  - First launch requires Node/npm, Rust/Cargo, and native Tauri build tools.
  - Debian/Ubuntu Linux also needs libdbus-1-dev and libglib2.0-dev.
  - gio-sys requires gio-2.0 >= 2.70; older distros may need an OS upgrade.
  - The production binary is built at src-tauri/target/release/klogcat.
`);
}

function commandSucceeds(command, commandArgs) {
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    stdio: 'ignore',
    shell: process.platform === 'win32',
  });
  return result.status === 0;
}

function printLinuxDependencyHint() {
  if (process.platform !== 'linux') {
    return;
  }

  const missing = [];
  if (!commandSucceeds('pkg-config', ['--exists', 'dbus-1'])) {
    missing.push('dbus-1');
  }
  if (!commandSucceeds('pkg-config', ['--atleast-version=2.70', 'gio-2.0'])) {
    missing.push('gio-2.0 >= 2.70');
  }
  if (missing.length === 0) {
    return;
  }

  console.warn(`
klogcat Linux build dependency check failed: ${missing.join(', ')}

Tauri's Linux dependency chain uses Rust crates such as libdbus-sys and gio-sys.
Those crates need native development packages discoverable via pkg-config.

Debian/Ubuntu:
  sudo apt-get update
  sudo apt-get install -y pkg-config libdbus-1-dev libglib2.0-dev

Full Debian/Ubuntu Tauri prerequisite set:
  sudo apt-get install -y nodejs npm cargo rustc pkg-config libdbus-1-dev libglib2.0-dev \\
    libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev

Important:
  gio-sys requires gio-2.0 >= 2.70. Ubuntu 20.04 / Debian 11 may be too old.
  Use Ubuntu 22.04+ / Debian 12+, or install a newer GLib/GIO toolchain.

Fedora:
  sudo dnf install dbus-devel glib2-devel pkgconf-pkg-config

Arch:
  sudo pacman -S dbus glib2 pkgconf
`);
}

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...options,
  });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

if (args.includes('--help') || args.includes('-h')) {
  printHelp();
  process.exit(0);
}

if (args.includes('--dev')) {
  printLinuxDependencyHint();
  run('npm', ['run', 'tauri', 'dev']);
  process.exit(0);
}

if (!existsSync(binary)) {
  if (args.includes('--no-build')) {
    console.error(`klogcat binary not found: ${binary}`);
    console.error('Run `klogcat --build-only` first.');
    process.exit(1);
  }
  console.log('klogcat binary not found. Building release binary...');
  printLinuxDependencyHint();
  run('npm', ['run', 'tauri', 'build', '--', '--no-bundle']);
}

if (args.includes('--build-only')) {
  console.log(`Built: ${binary}`);
  process.exit(0);
}

const child = spawn(binary, args.filter((arg) => !['--no-build'].includes(arg)), {
  cwd: root,
  stdio: 'inherit',
  detached: false,
});

child.on('error', (error) => {
  console.error(error.message);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
