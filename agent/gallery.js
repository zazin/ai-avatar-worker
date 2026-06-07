'use strict';
// Put a local image into the phone gallery so TikTok can pick it up.
//
// `adb push` is the trick that sidesteps Termux's scoped-storage limits: the adb
// CLIENT (Termux uid) reads our own temp file, and the adb DAEMON (shell uid)
// writes it to /sdcard — which the Termux app process itself isn't allowed to do
// on a modern MIUI device. Then a media-scan broadcast indexes it in MediaStore.

const path = require('path');
const { runAdb } = require('./adb');

async function pushToPhone(localPath, { destDir = '/sdcard/Pictures', scanMedia = true } = {}) {
  const name = path.basename(localPath);
  const remote = `${destDir.replace(/\/+$/, '')}/${name}`;

  await runAdb(['push', localPath, remote]);

  if (scanMedia) {
    await runAdb([
      'shell', 'am', 'broadcast',
      '-a', 'android.intent.action.MEDIA_SCANNER_SCAN_FILE',
      '-d', `file://${remote}`,
    ]);
  }
  return remote;
}

module.exports = { pushToPhone };
