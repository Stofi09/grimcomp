#!/usr/bin/env node
/* eslint-disable */
// Pin the iOS simulator that `npm run ios` opens, per project.
//
// Why: `expo start --ios` (SDK 51) has no `--device` flag — it picks the
// first already-booted iOS simulator, which means whichever one happens to
// be running from another project wins. So we:
//   1. Boot the target device ourselves (no-op if already booted).
//   2. Start Metro with plain `expo start` (no auto-launch).
//   3. Wait for the "Waiting on http://localhost:..." line from Metro.
//   4. `xcrun simctl openurl <target-udid> exp://localhost:<port>` —
//      this guarantees Expo Go opens on the device we want.
//
// Usage:  node scripts/dev-ios.js "iPad Pro 13-inch (M5)"
// Or via env:   EXPO_IOS_DEVICE='iPhone 17 Pro' node scripts/dev-ios.js
//
// List devices: `xcrun simctl list devices available`

const { execFileSync, spawn } = require('child_process');

const DEFAULT = 'iPad Pro 13-inch (M5)';
const target = process.argv[2] || process.env.EXPO_IOS_DEVICE || DEFAULT;

function listDevices() {
  const out = execFileSync('xcrun', ['simctl', 'list', 'devices', 'available', '-j'], {
    encoding: 'utf8',
  });
  return JSON.parse(out);
}

function findDevice(name) {
  const list = listDevices().devices;
  for (const runtime of Object.keys(list)) {
    for (const dev of list[runtime]) if (dev.name === name) return dev;
  }
  return null;
}

function suggest(name) {
  const list = listDevices().devices;
  const all = [];
  for (const runtime of Object.keys(list)) {
    for (const dev of list[runtime]) all.push(dev.name);
  }
  const needle = name.toLowerCase().split(' ')[0];
  return all.filter(n => n.toLowerCase().includes(needle)).slice(0, 5);
}

function bootIfNeeded(dev) {
  if (dev.state === 'Booted') {
    process.stdout.write(`✓ ${dev.name} already booted\n`);
    return;
  }
  process.stdout.write(`→ Booting ${dev.name} (${dev.udid})…\n`);
  try {
    execFileSync('xcrun', ['simctl', 'boot', dev.udid], { stdio: 'inherit' });
  } catch {
    /* simctl exits non-zero on already-booted; ignore */
  }
}

function openSimulatorApp() {
  try {
    execFileSync('open', ['-a', 'Simulator'], { stdio: 'ignore' });
  } catch { /* ignore */ }
}

function openExpoOnDevice(udid, port) {
  try {
    execFileSync('xcrun', ['simctl', 'openurl', udid, `exp://localhost:${port}`], {
      stdio: 'inherit',
    });
    process.stdout.write(`✓ Opened Expo Go on the target device.\n`);
  } catch (err) {
    process.stderr.write(`✗ Could not openurl on ${udid}: ${err.message}\n`);
  }
}

function startExpo(udid) {
  const child = spawn('npx', ['expo', 'start'], {
    stdio: ['inherit', 'pipe', 'pipe'],
    env: process.env,
  });

  let opened = false;
  const PORT_RE = /Waiting on http:\/\/localhost:(\d+)/i;

  const handleChunk = (chunk, sink) => {
    sink.write(chunk);
    if (opened) return;
    const match = chunk.toString().match(PORT_RE);
    if (match) {
      opened = true;
      const port = match[1];
      // Small delay: Metro's manifest endpoint sometimes 404s for a beat.
      setTimeout(() => openExpoOnDevice(udid, port), 600);
    }
  };

  child.stdout.on('data', c => handleChunk(c, process.stdout));
  child.stderr.on('data', c => handleChunk(c, process.stderr));

  child.on('exit', code => process.exit(code ?? 0));
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => child.kill(sig));
  }
}

function main() {
  const dev = findDevice(target);
  if (!dev) {
    process.stderr.write(`✗ No simulator named "${target}".\n`);
    const s = suggest(target);
    if (s.length) {
      process.stderr.write(`  Did you mean:\n`);
      for (const n of s) process.stderr.write(`    - ${n}\n`);
    }
    process.stderr.write(`  Full list: xcrun simctl list devices available\n`);
    process.exit(1);
  }
  bootIfNeeded(dev);
  openSimulatorApp();
  startExpo(dev.udid);
}

main();
