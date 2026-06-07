// One-shot test publisher — sends a message to HiveMQ so the Termux consumer can show it.
// Credentials from env: HIVEMQ_HOST=... HIVEMQ_USERNAME=... HIVEMQ_PASSWORD=... node publish-test.js
const mqtt = require('mqtt');
const c = mqtt.connect(`mqtts://${process.env.HIVEMQ_HOST}:${process.env.HIVEMQ_PORT || 8883}`, {
  username: process.env.HIVEMQ_USERNAME,
  password: process.env.HIVEMQ_PASSWORD,
});
c.on('connect', () => {
  const topic = 'test/termux';
  const msg = 'hello from Mac at ' + new Date().toISOString();
  c.publish(topic, msg, { qos: 1 }, () => {
    console.log(`published to ${topic}: ${msg}`);
    c.end(() => process.exit(0));
  });
});
c.on('error', (e) => { console.error('publish error:', e.message); process.exit(1); });
