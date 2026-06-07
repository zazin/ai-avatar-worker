// HiveMQ Cloud MQTT consumer — runs in Node.js inside Termux on Android.
// Subscribes over TLS (port 8883) and logs every message it receives.
//
// Usage:  node mqtt-consumer.js [topic]
//   topic defaults to "#" (all topics). Pass one or more topics as args.

const mqtt = require('mqtt');

// Credentials come from the environment (never hard-code secrets):
//   HIVEMQ_HOST=... HIVEMQ_USERNAME=... HIVEMQ_PASSWORD=... node mqtt-consumer.js
const HOST = process.env.HIVEMQ_HOST;
const PORT = parseInt(process.env.HIVEMQ_PORT, 10) || 8883;
const USERNAME = process.env.HIVEMQ_USERNAME;
const PASSWORD = process.env.HIVEMQ_PASSWORD;
if (!HOST || !USERNAME || !PASSWORD) {
  console.error('Set HIVEMQ_HOST, HIVEMQ_USERNAME, HIVEMQ_PASSWORD in the environment.');
  process.exit(1);
}

// Topics to subscribe to (CLI args override the default "#" = everything).
const topics = process.argv.slice(2);
if (topics.length === 0) topics.push('#');

const url = `mqtts://${HOST}:${PORT}`;
console.log(`[mqtt] connecting to ${url} as "${USERNAME}" ...`);

const client = mqtt.connect(url, {
  username: USERNAME,
  password: PASSWORD,
  protocol: 'mqtts',
  rejectUnauthorized: true,       // verify the broker's TLS certificate
  reconnectPeriod: 5000,          // auto-reconnect every 5s if dropped
  connectTimeout: 30_000,
  clientId: 'termux-android-' + Math.random().toString(16).slice(2, 10),
});

client.on('connect', () => {
  console.log('[mqtt] connected');
  client.subscribe(topics, { qos: 1 }, (err, granted) => {
    if (err) {
      console.error('[mqtt] subscribe error:', err.message);
      return;
    }
    granted.forEach((g) => console.log(`[mqtt] subscribed: ${g.topic} (qos ${g.qos})`));
    console.log('[mqtt] waiting for messages... (Ctrl-C to quit)');
  });
});

client.on('message', (topic, payload) => {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${topic}  ->  ${payload.toString()}`);
});

client.on('reconnect', () => console.log('[mqtt] reconnecting...'));
client.on('close', () => console.log('[mqtt] connection closed'));
client.on('error', (err) => console.error('[mqtt] error:', err.message));

// Clean shutdown on Ctrl-C.
process.on('SIGINT', () => {
  console.log('\n[mqtt] shutting down...');
  client.end(true, () => process.exit(0));
});
