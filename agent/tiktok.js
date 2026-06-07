'use strict';
// Auto-post an already-on-phone image to TikTok by driving its UI over adb.
//
// Ported from the Python reference (tiktok_poster.py). Two phases:
//   Phase 1 (reliable): fire an ACTION_SEND intent so TikTok opens its composer
//     with the image attached. Needs a MediaStore content:// URI (file:// is
//     blocked by scoped storage).
//   Phase 2 (brittle, opt-in): walk an ordered list of per-screen button labels,
//     dumping the UI tree and tapping the match. On an unrecognized screen it
//     STOPS and returns 'needs_manual' rather than tapping blindly.
//
// This depends on TikTok's current UI and is arguably against TikTok's ToS.
// When the UI shifts, tune the constants below.

const { runAdb } = require('./adb');

const TIKTOK_PACKAGES = ['com.zhiliaoapp.musically', 'com.ss.android.ugc.trill'];

// ORDERED sequence of screen-advances; each entry = equivalent labels (EN + ID)
// for one screen. Order matters so an ambiguous label can't be tapped early.
const POST_FLOW_STEPS = [
  ['Foto', 'Photo'],                                  // share sheet -> post as photo
  ['Berikutnya', 'Next', 'Selanjutnya'],              // editor -> next
  ['Posting', 'Post', 'Posting sekarang', 'Kirim'],   // final -> publish
];

// Caption/title fields to tap before the final post.
const CAPTION_HINTS = [
  'Tambahkan judul yang menarik',
  'Tambahkan deskripsi',
  'Add a title',
  'Add caption',
  'Tell viewers about your post',
];

const STEP_DELAY = 2500;   // ms to wait for a screen to settle
const STEP_RETRIES = 6;    // polls while a screen loads

class TikTokPostError extends Error {}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function installedPackage() {
  let out;
  try {
    out = await runAdb(['shell', 'pm', 'list', 'packages']);
  } catch (_) {
    return null;
  }
  const installed = new Set(
    out.split('\n').map((l) => l.replace('package:', '').trim())
  );
  for (const pkg of TIKTOK_PACKAGES) {
    if (installed.has(pkg)) return pkg;
  }
  return null;
}

// Resolve /sdcard/... to its MediaStore content:// URI. Matches on
// _display_name (filename), not _data (full path), because a _data WHERE clause
// returns nothing on scoped-storage / MIUI devices.
async function resolveContentUri(remotePath) {
  const name = remotePath.split('/').pop();
  const safe = name.replace(/'/g, "''");
  const out = await runAdb([
    'shell', 'content', 'query',
    '--uri', 'content://media/external/images/media',
    '--projection', '_id',
    '--where', `"_display_name='${safe}'"`,
  ]);
  const ids = [...out.matchAll(/_id=(\d+)/g)].map((m) => parseInt(m[1], 10));
  if (!ids.length) return null;
  // Most recently inserted row (highest _id) is the file we just pushed.
  return `content://media/external/images/media/${Math.max(...ids)}`;
}

async function openInTikTok(remotePath, { pkg } = {}) {
  const usedPkg = pkg || (await installedPackage());
  if (!usedPkg) {
    throw new TikTokPostError(`TikTok not found on device. Looked for: ${TIKTOK_PACKAGES.join(', ')}`);
  }
  const uri = await resolveContentUri(remotePath);
  if (!uri) {
    throw new TikTokPostError(
      `Image ${remotePath} is not indexed in MediaStore yet — push it with media scan first.`
    );
  }
  await runAdb([
    'shell', 'am', 'start',
    '-a', 'android.intent.action.SEND',
    '-t', 'image/*',
    '--eu', 'android.intent.extra.STREAM', uri,
    '--grant-read-uri-permission',
    '-p', usedPkg,
  ]);
  return usedPkg;
}

async function dumpUi() {
  await runAdb(['shell', 'uiautomator', 'dump', '/sdcard/window_dump.xml']);
  return runAdb(['shell', 'cat', '/sdcard/window_dump.xml']);
}

function centerOfBounds(bounds) {
  const m = /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(bounds || '');
  if (!m) return null;
  const [x1, y1, x2, y2] = m.slice(1).map(Number);
  return [Math.floor((x1 + x2) / 2), Math.floor((y1 + y2) / 2)];
}

// Find the center of the first node whose text/content-desc matches a label.
// Regex over the dump (the labels we match are plain ASCII button text).
function findTappable(xml, labels) {
  const wanted = new Set(labels.map((l) => l.toLowerCase()));
  const nodeRe = /<node\b[^>]*>/g;
  let m;
  while ((m = nodeRe.exec(xml)) !== null) {
    const tag = m[0];
    const text = (/\btext="([^"]*)"/.exec(tag)?.[1] || '').trim().toLowerCase();
    const desc = (/\bcontent-desc="([^"]*)"/.exec(tag)?.[1] || '').trim().toLowerCase();
    if (wanted.has(text) || wanted.has(desc)) {
      const bounds = /\bbounds="([^"]*)"/.exec(tag)?.[1];
      const c = centerOfBounds(bounds);
      if (c) return c;
    }
  }
  return null;
}

async function tap(x, y) {
  await runAdb(['shell', 'input', 'tap', String(x), String(y)]);
}

async function waitAndTap(labels, { retries = STEP_RETRIES, delay = STEP_DELAY } = {}) {
  for (let i = 0; i < retries; i++) {
    const target = findTappable(await dumpUi(), labels);
    if (target) {
      await tap(target[0], target[1]);
      await sleep(delay);
      return true;
    }
    await sleep(delay);
  }
  return false;
}

// `adb input text` can't type emoji/non-ASCII; strip those (the full caption
// still lives in the published message). Quotes confuse the shell; spaces -> %s.
function sanitizeLine(line) {
  const ascii = line.replace(/[^\x20-\x7E]/g, '');
  const noQuotes = ascii.replace(/["'`]/g, '');
  return noQuotes.replace(/[ \t]+/g, ' ').trim();
}

async function inputLine(line) {
  const safe = sanitizeLine(line).replace(/ /g, '%s');
  if (safe) await runAdb(['shell', 'input', 'text', safe]);
}

async function typeCaption(text) {
  const field = findTappable(await dumpUi(), CAPTION_HINTS);
  if (!field) return false;
  await tap(field[0], field[1]);
  await sleep(1000);

  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) {
      await runAdb(['shell', 'input', 'keyevent', '66']); // ENTER -> newline
      await sleep(300);
    }
    await inputLine(lines[i]);
    await sleep(300);
  }
  await runAdb(['shell', 'input', 'keyevent', '111']); // ESCAPE -> hide keyboard
  await sleep(500);
  return true;
}

// Combine caption + description into TikTok's single text field.
function buildPostText(caption, description) {
  const cap = (caption || '').trim();
  const desc = (description || '').trim();
  if (cap && desc) return `${cap}\n${desc}`;
  return cap || desc;
}

// Phase 1 always opens the composer. With autoPost=false returns 'composer_open'.
// With autoPost=true walks the post flow and returns 'posted' or 'needs_manual'.
// With publish=false (rehearsal): walks every screen and types the caption but
// does NOT tap the final publish button — returns 'ready' if that button is
// present, else 'needs_manual'. Lets you confirm the flow without going public.
async function post(remotePath, { caption, description, pkg, autoPost = false, publish = true } = {}) {
  await openInTikTok(remotePath, { pkg });
  await sleep(STEP_DELAY);

  if (!autoPost) return 'composer_open';

  const postText = buildPostText(caption, description);
  const lastIdx = POST_FLOW_STEPS.length - 1;
  for (let idx = 0; idx < POST_FLOW_STEPS.length; idx++) {
    if (idx === lastIdx && postText) {
      try { await typeCaption(postText); } catch (_) { /* best-effort */ }
    }
    if (idx === lastIdx && !publish) {
      // Rehearsal: confirm the publish button is there, but don't tap it.
      const found = findTappable(await dumpUi(), POST_FLOW_STEPS[idx]);
      return found ? 'ready' : 'needs_manual';
    }
    if (!(await waitAndTap(POST_FLOW_STEPS[idx]))) {
      return 'needs_manual'; // unrecognized screen — leave it for a human
    }
  }
  return 'posted';
}

module.exports = {
  post,
  openInTikTok,
  buildPostText,
  installedPackage,
  resolveContentUri,
  TikTokPostError,
  TIKTOK_PACKAGES,
  POST_FLOW_STEPS,
  CAPTION_HINTS,
};
