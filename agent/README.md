# termux-tiktok-agent

The **fully on-device** half of the TikTok auto-publish system, written in
Node.js to run **inside Termux on the phone itself** — no computer needed at
runtime. It drains a HiveMQ work topic and, for each queued post, downloads the
image, drops it in the gallery, and auto-posts it to TikTok by driving the UI.

It is a Node port of the Python reference
[`tiktok-agent`](../../PycharmProjects/tiktok-agent), with one key change: instead
of driving the phone over **USB adb from a computer**, it drives the phone's
**own** adb daemon over a loopback connection, so the device is autonomous.

```
HiveMQ (tiktok/posts)  ──►  agent.js (Termux)  ──►  TikTok
  {Caption, Description,       download image            composer + auto Next/Post
   ImageURL, ImagePath, id}    adb push to gallery
                               open SEND intent
  status topic  ◄──  publish {id, status} + ack
```

## Why on-device adb

A normal Termux app process cannot inject taps (`input tap`) or read the UI
(`uiautomator dump`) — those need the privileged `shell` uid. The workaround is
**Wireless Debugging / adb over TCP**: Termux runs an `adb` client that connects
to the phone's own adb daemon (`127.0.0.1:5555`). That daemon runs as `shell`, so
commands sent through it can tap, dump UI, write `/sdcard`, and fire intents.

`adb push` is also how images reach `/sdcard` despite scoped storage: the adb
client (Termux uid) reads our temp file and the adb daemon (shell uid) writes it.

## One-time setup (on the phone, in Termux)

```bash
pkg install -y nodejs android-tools

# Enable adb-over-TCP. Easiest is once from a computer on USB:
#   adb tcpip 5555
# or turn on Settings → Developer options → Wireless debugging and pair.

adb connect 127.0.0.1:5555      # accept the "Allow debugging?" prompt (always allow)
adb -s 127.0.0.1:5555 shell id  # should print uid=2000(shell) ...

cd agent && npm install
cp config.example.json config.json   # then fill in your HiveMQ creds
```

> Security note: `adb tcpip 5555` exposes adb to the whole local network until
> reboot/`adb usb`. Prefer Wireless Debugging (paired, random port) where you can.
> `adb tcpip` does **not** survive a reboot.

## Run

```bash
node agent.js --catch-up     # FIRST: ack the existing backlog without posting it
node agent.js                # watch forever, auto-post each NEW message
node agent.js --no-auto-post # download + push to gallery only (manual finish)
node agent.js --once         # drain the current backlog once, then exit
```

Keep it alive across screen-off / app-switch:

```bash
termux-wake-lock
nohup node agent.js > agent.log 2>&1 &
tail -f agent.log
```

## Config

`config.json` (gitignored) or env vars; env wins. See `config.example.json`.

| key | env | default |
|-----|-----|---------|
| `hivemq.host` | `HIVEMQ_HOST` | — (required) |
| `hivemq.username` / `.password` | `HIVEMQ_USERNAME` / `HIVEMQ_PASSWORD` | — (required) |
| `hivemq.workTopic` | `HIVEMQ_TOPIC` | `tiktok/posts` |
| `hivemq.statusTopic` | `HIVEMQ_STATUS_TOPIC` | `tiktok/status` |
| `hivemq.clientId` | `HIVEMQ_CLIENT_ID` | `termux-tiktok-agent` |
| `adbTarget` | `ADB_TARGET` | `127.0.0.1:5555` |
| `destDir` | `DEST_DIR` | `/sdcard/Pictures` |
| `autoPost` | `AUTO_POST` | `true` |

## Message contract

Work topic (QoS 1) JSON: `id` **or** `AirtableRecordId` (correlation key),
`Caption`, `Description`, `ImageURL` (public CDN), `ImagePath`, `CreatedAt`.
Status topic: `{ id, status: "posted"|"failed", ts }`.

## Durability

Persistent session (`clean:false` + stable `clientId`) means the broker queues
messages while the phone is offline. Each message is acked **only after** the
post reaches a terminal state — implemented by overriding `client.handleMessage`
(MQTT.js sends the PUBACK from its callback, one message at a time). A crash
between a successful post and the ack can cause one re-post on reconnect.

## When TikTok's UI changes

Tune the constants at the top of `tiktok.js`: `TIKTOK_PACKAGES`,
`POST_FLOW_STEPS` (ordered per-screen button labels, EN + ID), `CAPTION_HINTS`,
`STEP_DELAY`, `STEP_RETRIES`. On an unrecognized screen the agent stops and marks
the post `needs_manual`/`failed` rather than tapping blindly.

> UI automation depends on TikTok's current UI and may violate TikTok's ToS.
