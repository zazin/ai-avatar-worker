// Publish ONE test post to the tiktok/posts work topic (message contract).
// Credentials from env: HIVEMQ_HOST=... HIVEMQ_USERNAME=... HIVEMQ_PASSWORD=... node publish-tiktok-test.js
const mqtt = require('mqtt');
const c = mqtt.connect(`mqtts://${process.env.HIVEMQ_HOST}:${process.env.HIVEMQ_PORT || 8883}`, {
  username: process.env.HIVEMQ_USERNAME,
  password: process.env.HIVEMQ_PASSWORD,
});
c.on('connect', () => {
  const id = 'test-' + Math.floor(Date.now() / 1000);
  const msg = {
    id,
    Caption: 'Test post from termux-tiktok agent',
    Description: 'End-to-end verification, please ignore.',
    ImageURL: 'https://picsum.photos/id/237/600/800.jpg', // public, no auth
    ImagePath: id + '.jpg',
    CreatedAt: new Date().toISOString(),
  };
  c.publish('tiktok/posts', JSON.stringify(msg), { qos: 1 }, () => {
    console.log('published test post id=' + id);
    c.end(() => process.exit(0));
  });
});
c.on('error', (e) => { console.error('publish error:', e.message); process.exit(1); });
