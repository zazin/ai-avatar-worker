'use strict';
// HiveMQ (MQTT) work queue — the source of truth.
//
// Durability without a database: a persistent session (clean=false + stable
// clientId) so the broker queues messages while we're offline, plus QoS 1, plus
// "ack only after the post finishes". The last part is done by overriding
// client.handleMessage: MQTT.js sends the PUBACK in the callback that override
// receives, and processes one message at a time (backpressure). So we call the
// callback only after a terminal outcome:
//   handle() resolves 'posted' | 'failed' -> cb()      -> PUBACK (message dropped)
//   handle() resolves 'retry'             -> cb(err)    -> no PUBACK (redelivered)
//   handle() throws                       -> cb(err)    -> no PUBACK (redelivered)

const mqtt = require('mqtt');

// Parse a work message into { id, fields }, or null if unusable. The pipeline's
// correlation key has been seen as both `id` and `AirtableRecordId`.
function parseRecord(payloadBuf) {
  let payload;
  try {
    payload = JSON.parse(payloadBuf.toString('utf8'));
  } catch (_) {
    return null;
  }
  if (!payload || typeof payload !== 'object') return null;

  const id = payload.id || payload.AirtableRecordId || payload.ImagePath;
  const url = payload.ImageURL;
  if (!id || !url) return null;

  return {
    id: String(id),
    fields: {
      Caption: payload.Caption,
      Description: payload.Description,
      ImageURL: url,
      ImagePath: payload.ImagePath,
      CreatedAt: payload.CreatedAt,
    },
    raw: payload,
  };
}

function connect(cfg) {
  const h = cfg.hivemq;
  return mqtt.connect(`mqtts://${h.host}:${h.port}`, {
    username: h.username,
    password: h.password,
    clientId: h.clientId,
    clean: false,           // persistent session (broker queues while offline)
    protocolVersion: 4,     // MQTT 3.1.1
    reconnectPeriod: 5000,
    connectTimeout: 30000,
    resubscribe: false,     // we (re)subscribe explicitly in the connect handler
    rejectUnauthorized: true,
  });
}

// Run the consumer.
//   handle(record, { publishStatus }) -> 'posted' | 'failed' | 'retry'
//   idleExitMs: if > 0, disconnect after that long with no message (--once/--catch-up)
// Resolves when the client ends.
function runConsumer(cfg, { handle, idleExitMs = 0 } = {}) {
  const h = cfg.hivemq;
  const client = connect(cfg);
  runConsumer._client = client;

  let idleTimer = null;
  const resetIdle = () => {
    if (!idleExitMs) return;
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => client.end(), idleExitMs);
  };

  // Publish the outcome to the status topic. Resolves as soon as the packet is
  // handed to the client (NOT when the PUBACK returns): we may be called from
  // inside handleMessage, where MQTT.js has paused the incoming stream for
  // backpressure, so awaiting the PUBACK here would deadlock. QoS-1 reliability
  // is preserved by the client's outgoing store, which retransmits until acked;
  // a graceful client.end() flushes those before exit.
  const publishStatus = (id, status) =>
    new Promise((resolve) => {
      const body = JSON.stringify({ id, status, ts: Math.floor(Date.now() / 1000) });
      client.publish(h.statusTopic, body, { qos: 1 });
      resolve();
    });

  // Backpressure + precise ack control (see file header).
  client.handleMessage = (packet, cb) => {
    resetIdle();
    const rec = parseRecord(packet.payload);
    if (!rec) {
      cb(); // malformed -> drop so it can't loop
      return;
    }
    Promise.resolve()
      .then(() => handle(rec, { publishStatus }))
      .then((result) => cb(result === 'retry' ? new Error('retry') : undefined))
      .catch((err) => cb(err)); // unexpected -> leave unacked, redeliver
  };

  return new Promise((resolve, reject) => {
    client.on('connect', (connack) => {
      console.log(new Date().toISOString(), `[mqtt] connected (sessionPresent=${connack.sessionPresent})`);
      client.subscribe(h.workTopic, { qos: 1 }, (err) => {
        if (err) {
          reject(err);
          return;
        }
        console.log(new Date().toISOString(), `[mqtt] subscribed: ${h.workTopic}`);
        resetIdle();
      });
    });
    client.on('reconnect', () => console.log(new Date().toISOString(), '[mqtt] reconnecting...'));
    client.on('error', (err) => console.error(new Date().toISOString(), '[mqtt] error:', err.message));
    client.on('close', () => console.log(new Date().toISOString(), '[mqtt] connection closed'));
    client.on('end', () => resolve());

    const stop = () => client.end();
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
}

module.exports = { runConsumer, parseRecord, connect };
