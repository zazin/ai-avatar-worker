# termux-tiktok

Autonomous **on-device** TikTok auto-publishing: a Node.js agent that runs
**inside [Termux](https://termux.dev) on an Android phone** (no computer needed at
runtime), drains a HiveMQ work queue, and for each queued post downloads the
image, drops it in the gallery, and auto-posts it to TikTok by driving the UI.

It's the device-side, self-contained counterpart to the Python reference
[`tiktok-agent`](../../PycharmProjects/tiktok-agent) (which runs on a computer and
drives the phone over USB). This project moves the whole thing **onto the phone**.

```
HiveMQ (tiktok/posts)  ──►  agent.js  (Termux, on the phone)  ──►  TikTok
  {Caption, Description,       download image                       composer → Foto
   ImageURL, ImagePath,        adb push → /sdcard (gallery)         → Berikutnya/Next
   id/AirtableRecordId}        open SEND intent                     → type caption
                               drive UI via on-device adb           → Posting
  tiktok/status  ◄──  publish {id, status} + ack (after post)
```

## Layout

| path | what |
|------|------|
| [`agent/`](agent/) | **the agent** — MQTT consumer, image download, gallery push, TikTok UI automation. See [`agent/README.md`](agent/README.md) for full docs. |
| `termux-node-app/` | earlier experiments used to bring the device up: a hello-world Node app and a HiveMQ consumer/publisher that validated the device + the MQTT message contract. |

## How it works (the hard parts)

A normal Termux app can't inject taps or read the UI — those need the privileged
`shell` uid. So the agent talks to the phone's **own** adb daemon over a loopback
connection (Wireless Debugging / `adb tcpip`), giving it `shell`-level control of
TikTok from on-device. The same `adb push` trick is how images get onto `/sdcard`
despite MIUI's scoped storage (adb client = Termux uid reads the temp file, adb
daemon = shell uid writes `/sdcard`).

Durability with no database: a persistent MQTT session (`clean:false` + stable
clientId) queues work while the phone is offline, and each message is acked only
**after** the post reaches a terminal state.

## Quick start

On the phone, in Termux (one-time setup — full details in
[`agent/README.md`](agent/README.md)):

```bash
pkg install -y nodejs android-tools
adb tcpip 5555            # enable adb over TCP (from USB once; resets on reboot)
adb connect 127.0.0.1:5555   # accept the on-screen prompt ("Always allow")

cd agent && npm install
cp config.example.json config.json   # fill in your HiveMQ creds
```

Run:

```bash
node agent.js --catch-up   # FIRST: ack the existing backlog without posting
node agent.js --dry-run    # rehearse the full flow but stop before tapping Post
node agent.js              # LIVE: auto-post every new message
```

To develop/test from a computer over USB instead, set `ADB_TARGET=<serial>`:

```bash
ADB_TARGET=827b946 node agent.js --dry-run
```

## Updating the app

The agent on the phone should be a **git clone** — then every update is one
command and your local `config.json` (gitignored) is never disturbed.

One-time migration (if the phone currently has a *copied* folder, not a clone):

```bash
cd ~
cp tiktok-agent/config.json /sdcard/config.bak.json 2>/dev/null || cp tiktok-agent/config.json ./config.bak.json
git clone https://github.com/zazin/ai-avatar-worker.git
mv tiktok-agent tiktok-agent.old            # keep the old copy just in case
ln -s ai-avatar-worker/agent tiktok-agent   # or just `cd ai-avatar-worker/agent`
cp ./config.bak.json ai-avatar-worker/agent/config.json
cd ai-avatar-worker/agent && npm install
```

After that, to update at any time:

```bash
cd ~/ai-avatar-worker/agent
bash update.sh        # git pull + npm install + restart (logs → ~/tiktok-agent.log)
```

`update.sh` stops the previous run (tracked via `~/.tiktok-agent.pid`) and relaunches
detached, so you can fire-and-forget. Develop on the Mac, `git push`, then `bash
update.sh` on the phone — that's the whole loop.

## Status

Verified end-to-end (via `--dry-run`) on both Mac-over-USB and on-device Termux:
MQTT → download → gallery push → open TikTok → Foto → Next → type caption +
description → final preview with the **Posting** button ready. The literal final
publish tap is exercised only when you run without `--dry-run`.

> UI automation depends on TikTok's current UI and may be against TikTok's ToS.
> `adb tcpip` exposes adb to the local network until reboot/`adb usb` — prefer a
> trusted network or paired Wireless Debugging.

## Configuration & secrets

Credentials are read from `agent/config.json` (gitignored) or environment
variables (`HIVEMQ_HOST`, `HIVEMQ_USERNAME`, `HIVEMQ_PASSWORD`, …). No secrets are
committed; the test scripts in `termux-node-app/` also read creds from the env.
