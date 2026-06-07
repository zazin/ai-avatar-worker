'use strict';
// Configuration. Secrets come from config.json (gitignored) or environment
// variables; env always wins. Defaults below are non-secret.

const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  hivemq: {
    host: '',
    port: 8883,
    username: '',
    password: '',
    workTopic: 'tiktok/posts',
    statusTopic: 'tiktok/status',
    // Stable client id => persistent session (broker queues work while we're
    // offline and redelivers on reconnect). Deliberately NOT 'tiktok-agent' so
    // this on-device agent doesn't fight the Python reference agent's session.
    clientId: 'termux-tiktok-agent',
  },
  // adb target. 'auto' = auto-detect the single connected device via
  // `adb devices` (the usual case: phone on USB). Override with ADB_TARGET (or
  // config.json) to pin a serial, or a host:port loopback for Wireless Debugging.
  adbTarget: 'auto',
  destDir: '/sdcard/Pictures',
  autoPost: true,
};

function loadConfig() {
  const cfg = JSON.parse(JSON.stringify(DEFAULTS));

  const file = path.join(__dirname, 'config.json');
  if (fs.existsSync(file)) {
    let j;
    try {
      j = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
      throw new Error(`Failed to parse ${file}: ${e.message}`);
    }
    const hivemq = j.hivemq;
    Object.assign(cfg, j);
    if (hivemq) cfg.hivemq = Object.assign({}, DEFAULTS.hivemq, hivemq);
  }

  const env = process.env;
  const h = cfg.hivemq;
  h.host = env.HIVEMQ_HOST || h.host;
  h.port = parseInt(env.HIVEMQ_PORT, 10) || h.port;
  h.username = env.HIVEMQ_USERNAME || h.username;
  h.password = env.HIVEMQ_PASSWORD || h.password;
  h.workTopic = env.HIVEMQ_TOPIC || h.workTopic;
  h.statusTopic = env.HIVEMQ_STATUS_TOPIC || h.statusTopic;
  h.clientId = env.HIVEMQ_CLIENT_ID || h.clientId;
  cfg.adbTarget = env.ADB_TARGET || cfg.adbTarget;
  cfg.destDir = env.DEST_DIR || cfg.destDir;
  if (env.AUTO_POST != null) {
    cfg.autoPost = env.AUTO_POST !== '0' && env.AUTO_POST.toLowerCase() !== 'false';
  }

  if (!h.host || !h.username || !h.password) {
    throw new Error(
      'HiveMQ host/username/password missing. Put them in agent/config.json ' +
      '(see config.example.json) or set HIVEMQ_HOST/HIVEMQ_USERNAME/HIVEMQ_PASSWORD.'
    );
  }
  return cfg;
}

module.exports = { loadConfig, DEFAULTS };
