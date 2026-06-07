# tiktok-agent

Drains a HiveMQ work topic and, for each queued post, downloads the image, drops
it in the phone's gallery, and auto-posts it to TikTok by driving the app's UI.
It runs on your **computer and drives the phone over USB (adb)** — the device is
auto-detected. It is a Node port of the Python reference
[`tiktok-agent`](../../PycharmProjects/tiktok-agent).

```
HiveMQ (tiktok/posts)  ──►  agent.js  ──►  TikTok
  {Caption, Description,       download image      composer + auto Next/Post
   ImageURL, ImagePath, id}    adb push to gallery
                               open SEND intent
  status topic  ◄──  publish {id, status} + ack
```

## How adb drives the phone

`adb` runs commands on the phone as the `shell` uid, which is what lets the agent
inject taps (`input tap`), read the UI (`uiautomator dump`), fire intents, and
write `/sdcard`. `adb push` is also how images reach `/sdcard` despite scoped
storage: the adb daemon writes the file as `shell`.

## One-time setup

```bash
# On the phone: enable Developer options → USB debugging, plug in via USB,
# and accept the "Allow USB debugging?" prompt (tick "Always allow").
adb devices            # should list one device as "device"

npm install
cp config.example.json config.json   # then fill in your HiveMQ creds
```

## Run

```bash
npm run catch-up      # FIRST: ack the existing backlog without posting it
npm run dry-run       # rehearse the post flow but DON'T tap the final Post
npm start             # watch forever, auto-post each NEW message
npm run once          # drain the current backlog once, then exit
npm run no-auto-post  # download + push to gallery only (manual finish)
```

The device is **auto-detected**. With more than one device attached, pin a serial:
`ADB_TARGET=<serial> npm start`.

## Config

`config.json` (gitignored) or env vars; env wins. See `config.example.json`.

| key | env | default |
|-----|-----|---------|
| `hivemq.host` | `HIVEMQ_HOST` | — (required) |
| `hivemq.username` / `.password` | `HIVEMQ_USERNAME` / `HIVEMQ_PASSWORD` | — (required) |
| `hivemq.workTopic` | `HIVEMQ_TOPIC` | `tiktok/posts` |
| `hivemq.statusTopic` | `HIVEMQ_STATUS_TOPIC` | `tiktok/status` |
| `hivemq.clientId` | `HIVEMQ_CLIENT_ID` | `termux-tiktok-agent` |
| `adbTarget` | `ADB_TARGET` | `auto` (auto-detect the single device) |
| `destDir` | `DEST_DIR` | `/sdcard/Pictures` |
| `autoPost` | `AUTO_POST` | `true` |

## Message contract

Work topic (QoS 1) JSON: `id` **or** `AirtableRecordId` (correlation key),
`Caption`, `Description`, `ImageURL` (public CDN), `ImagePath`, `CreatedAt`.
Status topic: `{ id, status: "posted"|"failed", ts }`.

## Durability

Persistent session (`clean:false` + stable `clientId`) means the broker queues
messages while the agent is offline. Each message is acked **only after** the post
reaches a terminal state — implemented by overriding `client.handleMessage`
(MQTT.js sends the PUBACK from its callback, one message at a time). A crash
between a successful post and the ack can cause one re-post on reconnect.

## When TikTok's UI changes

Tune the constants at the top of `tiktok.js`: `TIKTOK_PACKAGES`,
`POST_FLOW_STEPS` (ordered per-screen button labels, EN + ID), `CAPTION_HINTS`,
`STEP_DELAY`, `STEP_RETRIES`. On an unrecognized screen the agent stops and marks
the post `needs_manual`/`failed` rather than tapping blindly.

> UI automation depends on TikTok's current UI and may violate TikTok's ToS.
