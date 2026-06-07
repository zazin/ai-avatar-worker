#!/usr/bin/env node
'use strict';
// termux-tiktok-agent — runs ON the phone inside Termux.
//
// Drains a HiveMQ work topic (persistent QoS-1 session) and for each message:
//   1. downloads the image from its ImageURL,
//   2. adb-pushes it into the gallery (via on-device loopback adb),
//   3. auto-posts it to TikTok by driving the UI over adb,
//   4. publishes the outcome to the status topic and acks the message.
//
// Usage:
//   node agent.js                # watch forever, auto-post each new message
//   node agent.js --no-auto-post # push to gallery only, leave messages pending
//   node agent.js --once         # drain current backlog once, then exit
//   node agent.js --catch-up     # ack the current backlog WITHOUT posting it

const os = require('os');
const fs = require('fs');
const path = require('path');

const { loadConfig } = require('./config');
const adb = require('./adb');
const { downloadImage } = require('./download');
const { pushToPhone } = require('./gallery');
const tiktok = require('./tiktok');
const { runConsumer } = require('./source');

const log = (...a) => console.log(new Date().toISOString(), ...a);

async function ensureAdb(cfg) {
  adb.setTarget(cfg.adbTarget);
  if (cfg.adbTarget.includes(':')) {
    const out = await adb.connect(cfg.adbTarget);
    log('[adb] connect:', out.trim().replace(/\n/g, ' '));
  }
  const id = await adb.runAdb(['shell', 'id']);
  if (!/uid=/.test(id)) {
    throw new Error(`adb shell not working against ${cfg.adbTarget}: ${id.trim()}`);
  }
  log('[adb] shell OK:', id.trim());
}

async function processRecord(cfg, rec, { publishStatus }, { publish = true } = {}) {
  const f = rec.fields;
  const url = f.ImageURL;
  const name =
    f.ImagePath || (url ? url.split('/').pop() : null) || `${rec.id}.jpg`;

  if (!url) {
    log('  SKIP', rec.id, '(no ImageURL)');
    await publishStatus(rec.id, 'failed');
    return 'failed';
  }

  const tmp = path.join(os.tmpdir(), name);
  try {
    await downloadImage(url, tmp);
    const remote = await pushToPhone(tmp, { destDir: cfg.destDir });
    log('  pushed', name, '->', remote);

    if (!cfg.autoPost) {
      log('  pushed only (--no-auto-post); leaving', rec.id, 'pending');
      return 'retry';
    }

    const status = await tiktok.post(remote, {
      caption: f.Caption,
      description: f.Description,
      autoPost: true,
      publish,
    });
    log('  tiktok:', status);

    if (!publish) {
      // Rehearsal: do not report or ack; leave the message pending.
      log('  dry-run: stopped before publishing; leaving', rec.id, 'pending');
      return 'retry';
    }
    const terminal = status === 'posted' ? 'posted' : 'failed';
    await publishStatus(rec.id, terminal);
    return terminal;
  } catch (e) {
    log('  FAILED', name, '-', e.message);
    try { await publishStatus(rec.id, 'failed'); } catch (_) { /* ignore */ }
    return 'failed';
  } finally {
    fs.promises.unlink(tmp).catch(() => {});
  }
}

async function main() {
  const args = process.argv.slice(2);
  const cfg = loadConfig();
  if (args.includes('--no-auto-post')) cfg.autoPost = false;
  const catchUp = args.includes('--catch-up');
  const once = args.includes('--once');
  const dryRun = args.includes('--dry-run'); // walk the flow but don't tap final Post

  await ensureAdb(cfg);
  log(
    `[cfg] HiveMQ=${cfg.hivemq.host} topic=${cfg.hivemq.workTopic} ` +
    `client=${cfg.hivemq.clientId} autoPost=${cfg.autoPost}`
  );

  if (catchUp) {
    log('Catch-up: acking current backlog WITHOUT posting...');
    let n = 0;
    await runConsumer(cfg, {
      idleExitMs: 4000,
      handle: async (rec, { publishStatus }) => {
        await publishStatus(rec.id, 'posted');
        n++;
        log('  catch-up acked', rec.id);
        return 'posted';
      },
    });
    log(`Catch-up done: ${n} message(s) acked.`);
    return;
  }

  const handle = (rec, ctx) => processRecord(cfg, rec, ctx, { publish: !dryRun });

  if (dryRun) log('DRY-RUN: will rehearse the post flow but NOT tap the final Post.');

  if (once || dryRun) {
    log('Single drain...');
    await runConsumer(cfg, { idleExitMs: 5000, handle });
  } else {
    log('Watching HiveMQ (Ctrl-C to stop)...');
    await runConsumer(cfg, { handle });
  }
}

main().catch((e) => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
