'use strict';
// Download an image from a public URL (the message's ImageURL, an ImageKit CDN
// link that needs no auth) to a local file. Uses the global fetch (Node 18+).

const fs = require('fs');

async function downloadImage(url, destPath) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) {
    throw new Error(`download failed: HTTP ${res.status} for ${url}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0) {
    throw new Error(`download produced 0 bytes for ${url}`);
  }
  await fs.promises.writeFile(destPath, buf);
  return destPath;
}

module.exports = { downloadImage };
