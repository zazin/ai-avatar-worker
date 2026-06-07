// Simple Node.js app — proves it ran inside Termux on the Android device.
const os = require('os');
const fs = require('fs');

const info = {
  message: 'Hello from Node.js running inside Termux!',
  timestamp: new Date().toISOString(),
  nodeVersion: process.version,
  platform: process.platform,       // 'android' when run in Termux
  arch: process.arch,
  hostname: os.hostname(),
  uptimeSeconds: Math.round(os.uptime()),
  HOME: process.env.HOME,           // /data/data/com.termux/files/home in Termux
  PREFIX: process.env.PREFIX,       // /data/data/com.termux/files/usr in Termux
};

const out = JSON.stringify(info, null, 2);
console.log(out);

// Write proof-of-run next to this script (Termux's app-private external dir,
// which is readable over adb without any storage permission).
const path = require('path');
try {
  fs.writeFileSync(path.join(__dirname, 'termux-node-output.txt'), out + '\n');
} catch (e) {
  console.error('Could not write output file:', e.message);
}
