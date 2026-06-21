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
  - Debian/Ubuntu Linux also needs libdbus-1-dev for libdbus-sys.
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
  if (commandSucceeds('pkg-config', ['--exists', 'dbus-1'])) {
    return;
  }

  console.warn(`
klogcat Linux build dependency missing: dbus-1

The Rust crate libdbus-sys needs the DBus development headers.

Debian/Ubuntu:
  sudo apt-get update
  sudo apt-get install -y libdbus-1-dev pkg-config

Fedora:
  sudo dnf install dbus-devel pkgconf-pkg-config

Arch:
  sudo pacman -S dbus pkgconf
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
