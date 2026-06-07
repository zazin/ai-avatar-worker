'use strict';
// Single chokepoint for every adb call (push, shell, intents, UI dumps, taps).
// The agent runs on a computer and drives the phone over USB; the target device
// is auto-detected (see autoDetectTarget) or pinned via ADB_TARGET. adb talks to
// the phone's daemon as the `shell` uid, which is what lets us inject taps and
// run uiautomator.

const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

class AdbError extends Error {}

let _target = null;

function setTarget(target) {
  _target = target;
}

async function runAdb(args, { timeout = 120000 } = {}) {
  const full = _target ? ['-s', _target, ...args] : args;
  try {
    const { stdout } = await execFileAsync('adb', full, {
      timeout,
      maxBuffer: 16 * 1024 * 1024,
    });
    return stdout;
  } catch (e) {
    if (e.code === 'ENOENT') {
      throw new AdbError('adb not found on PATH. In Termux: pkg install android-tools');
    }
    const msg = (e.stderr || e.stdout || e.message || '').toString().trim();
    throw new AdbError(`adb ${args.join(' ')} failed: ${msg}`);
  }
}

// `adb connect <host:port>` — not device-scoped, so bypass the -s target.
async function connect(target) {
  try {
    const { stdout } = await execFileAsync('adb', ['connect', target], { timeout: 15000 });
    return stdout;
  } catch (e) {
    return (e.stdout || e.stderr || e.message || '').toString();
  }
}

// Parse `adb devices` into [{serial, state}].
async function listDevices() {
  let stdout;
  try {
    ({ stdout } = await execFileAsync('adb', ['devices'], { timeout: 15000 }));
  } catch (e) {
    if (e.code === 'ENOENT') {
      throw new AdbError('adb not found on PATH.');
    }
    throw new AdbError(`adb devices failed: ${(e.stderr || e.message || '').toString().trim()}`);
  }
  return stdout
    .split('\n')
    .slice(1) // drop the "List of devices attached" header
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [serial, state] = l.split(/\s+/);
      return { serial, state };
    })
    .filter((d) => d.serial);
}

// Pick the single ready ("device") target automatically. Errors helpfully when
// there are zero or many, so the user knows to plug in or set ADB_TARGET.
async function autoDetectTarget() {
  const ready = (await listDevices()).filter((d) => d.state === 'device');
  if (ready.length === 0) {
    throw new AdbError(
      'No adb device connected. Plug in the phone (USB debugging enabled), ' +
      'confirm with `adb devices`, or set ADB_TARGET.'
    );
  }
  if (ready.length > 1) {
    throw new AdbError(
      `Multiple adb devices (${ready.map((d) => d.serial).join(', ')}). ` +
      'Set ADB_TARGET=<serial> to choose one.'
    );
  }
  return ready[0].serial;
}

module.exports = { runAdb, connect, setTarget, listDevices, autoDetectTarget, AdbError };
