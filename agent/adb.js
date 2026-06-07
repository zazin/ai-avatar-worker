'use strict';
// Single chokepoint for every adb call (push, shell, intents, UI dumps, taps).
// On-device in Termux the target is the loopback Wireless-Debugging endpoint
// (e.g. 127.0.0.1:5555); the adb client runs as the Termux uid while the adb
// daemon it talks to runs as the privileged `shell` uid — which is what lets us
// inject taps and run uiautomator that a plain app process cannot.

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

module.exports = { runAdb, connect, setTarget, AdbError };
