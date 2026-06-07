# termux-tiktok

TikTok auto-publishing: a Node.js agent that drains a HiveMQ work queue and, for
each queued post, downloads the image, drops it in the phone's gallery, and
auto-posts it to TikTok by driving the app's UI over **adb**.

It runs on your **computer (Mac) and drives the phone over USB** — the agent
auto-detects the connected device, so there's nothing to configure per-run. It is
a Node port of the Python reference
[`tiktok-agent`](../../PycharmProjects/tiktok-agent).

```
HiveMQ (tiktok/posts)  ──►  agent.js  (on the Mac, phone on USB)  ──►  TikTok
  {Caption, Description,       download image                            composer → Foto
   ImageURL, ImagePath,        adb push → /sdcard (gallery)              → Berikutnya/Next
   id/AirtableRecordId}        open SEND intent                          → type caption
                               drive UI over adb (USB)                   → Posting
  tiktok/status  ◄──  publish {id, status} + ack (after post)
```

## Layout

| path | what |
|------|------|
| [`agent/`](agent/) | **the agent** — MQTT consumer, image download, gallery push, TikTok UI automation. See [`agent/README.md`](agent/README.md) for full docs. |
| `termux-node-app/` | legacy experiments used to bring the device up: a hello-world Node app and a HiveMQ consumer/publisher that validated the device + the MQTT message contract. |

## How it works (the hard parts)

`adb` gives the agent `shell`-level control of the phone: `input tap` /
`uiautomator dump` to drive TikTok, and `adb push` to land the image on `/sdcard`
despite MIUI's scoped storage (the adb daemon writes as the `shell` uid).

Durability with no database: a persistent MQTT session (`clean:false` + stable
clientId) queues work while the agent is offline, and each message is acked only
**after** the post reaches a terminal state.

## Quick start

1. Plug in the phone and enable **USB debugging** (Developer options). Confirm it's
   visible:

   ```bash
   adb devices       # should list one device as "device"
   ```

2. Install deps and add your HiveMQ credentials:

   ```bash
   cd agent && npm install
   cp config.example.json config.json   # fill in your HiveMQ creds
   ```

## Run

From `agent/`, via npm scripts:

```bash
npm run catch-up    # FIRST: ack the existing backlog without posting
npm run dry-run     # rehearse the full flow but stop before tapping Post
npm start           # LIVE: auto-post every new message
npm run once        # drain the current backlog once, then exit
```

The agent **auto-detects** the connected device (no `ADB_TARGET` needed). If more
than one device is attached, pin one with `ADB_TARGET=<serial> npm start`.

## Updating

The agent lives in a git clone, so updates are one command — your local
`config.json` (gitignored) is never touched:

```bash
cd agent
git pull && npm install
```

## Status

Verified end-to-end (via `npm run dry-run`): MQTT → download → gallery push → open
TikTok → Foto → Next → type caption + description → final preview with the
**Posting** button ready. The literal final publish tap is exercised only when you
run `npm start` (no `--dry-run`).

> UI automation depends on TikTok's current UI and may be against TikTok's ToS.

## Configuration & secrets

Credentials are read from `agent/config.json` (gitignored) or environment
variables (`HIVEMQ_HOST`, `HIVEMQ_USERNAME`, `HIVEMQ_PASSWORD`, …). No secrets are
committed; the test scripts in `termux-node-app/` also read creds from the env.
