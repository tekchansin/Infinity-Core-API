# Getting started

This tutorial takes you from nothing to a working Infinity Core extension. You will write one that reads what plays,
then one that gives Infinity Core lyrics. Then you will run one in Docker and learn the other way to give Infinity Core
information: a web source.

The full rules are in the specification, [spec/SPEC.md](spec/SPEC.md). This page links to it instead of repeating it.
The SDK references are [sdk/python/README.md](sdk/python/README.md) and [sdk/js/README.md](sdk/js/README.md).

## Before you start

You need:

- An Infinity Core that has **Settings › Extensions**. The Infinity Core API is a preview while `core.info` says
  `"preview": true`: it can still change. Watch [spec/CHANGELOG.md](spec/CHANGELOG.md).
- To be the **Owner** of that Infinity Core, or to know them. Only the Owner can enable an extension: in Infinity
  Core's own app or page, or in the Mac, Windows or phone app connected to it. Never through Remote access.
- Python 3.9 or newer, or Node 18 or newer.
- A computer that can reach Infinity Core on port 8931: the same computer, another one at home, or the person's own
  Tailscale network. The API is never reachable through Remote access ([SPEC §2.2](spec/SPEC.md#22-the-connection)).

There are two kinds of extension:

| | a program (an "extension") | a web source |
|---|---|---|
| Runs | at home: a NAS, a Raspberry Pi, the same computer, Docker | on your own web server |
| Talks to Infinity Core | WebSocket, JSON-RPC 2.0 | Infinity Core sends plain https GETs |
| Can use Infinity Core | yes: see what plays, control it, change the library, switch sound | no |
| Can give Infinity Core | lyrics, album and artist information, covers, radio stations, menu items, amp volume and input, a status line, a settings dialog | lyrics, album and artist information, covers, radio stations |
| Added by | starting it; the Owner presses **Enable** | its address, in **Add web source** |

Most of this page is about programs. Web sources are at the end.

## 1. Install the SDK

### Python

The Python SDK is one file, `infinity_core_api.py`, with a `pyproject.toml` beside it. The package is called
`infinity-core-api`. It uses the standard library only.

```sh
pip install infinity-core-api                 # from PyPI
pip install "infinity-core-api[discovery]"    # also find Infinity Core on the network (adds zeroconf)
pip install ./sdk/python                      # or from a copy of the repository
```

You can also copy `sdk/python/infinity_core_api.py` next to your script. Nothing else is needed. The repository is
[github.com/tekchansin/Infinity-Core-API](https://github.com/tekchansin/Infinity-Core-API).

### JavaScript (Node)

```sh
npm i infinity-core-api
```

The JS SDK is one file, `index.mjs`, an ES module for Node 18 or newer, with no required dependencies. To find
Infinity Core on the network it uses the optional `bonjour-service` package, which npm installs unless you pass
`--omit=optional`.

Without discovery, give your extension Infinity Core's address. Both SDKs then connect to `wss://<address>:8931/ext/v1`.

## 2. Your first extension: what plays

This program prints what each zone plays. A zone is one profile's music: what it plays, its queue and its output. It
only needs the `read` scope.

```python
# what_plays.py
import asyncio
import sys
import time

import infinity_core_api as ica

ext = ica.Extension(
    id="org.example.what-plays",          # reverse-DNS, yours, the same in every version
    name="What Plays",
    version="1.0.0",
    publisher="you",
    description="Prints what each zone plays.",
    uses=["read"],                        # the scopes it needs (SPEC §4)
)


def seconds_in(np):
    """Where the song is now. `position` is true at `at` (the Core's clock, ms since 1970)."""
    if not np["playing"]:
        return np["position"]
    return np["position"] + (time.time() * 1000 - np["at"]) / 1000


def show(zone):
    np = zone.get("nowPlaying")
    line = f"{zone['name']}: {zone['state']}"
    if np:
        track = np["track"]
        line += f" - {track['title']} · {', '.join(track['artists'])} ({seconds_in(np):.0f} s)"
    if zone.get("private"):
        line += " (private session)"
    print(line)


@ext.on_state
async def state(s, result):
    if s == "waiting":
        print("Open Infinity Core › Settings › Extensions and enable What Plays.")


@ext.on_ready
async def ready(grant):
    print("Enabled. Acting as:", grant["actsAs"])
    now = await ext.subscribe(["zone.changed"])   # answers with the current zones
    for zone in now.get("zones", []):
        show(zone)


@ext.on("zone.changed")
async def changed(params):
    show(params["zone"])


asyncio.run(ext.run(host=sys.argv[1] if len(sys.argv) > 1 else ""))
```

What each part does:

- `Extension(...)` describes your extension. Infinity Core shows these fields to the Owner. The `id` is the
  reverse-DNS of a domain that is yours, like `org.example.what-plays`: lower-case `a`–`z`, `0`–`9`, `-` and `.`, at
  most 100 characters. Keep it the same in every version. `name` is at most 40 characters and `description` at most 200 ([SPEC §3.1](spec/SPEC.md#31-hello-extension--core-first-message)).
- `@ext.on_state` is told about every state: `waiting`, `enabled`, `disabled`, `removed`, `blocked`, `upgrade`, and
  `disconnected` once when the link drops.
- `@ext.on_ready` runs each time the extension is enabled: the first time, after every reconnect, and when the Owner
  changes what it may do. Do your set-up here.
- `ext.subscribe([...])` asks for events ([SPEC §6](spec/SPEC.md#6-events-core--extension-notifications)). Its answer
  is the current state of what you asked for: for `zone.changed`, a `zones` list. The SDK subscribes again by itself
  after a reconnect. `ext.unsubscribe([...])` stops an event for good.
- `@ext.on("zone.changed")` gets each event's `params`. A zone is described in
  [SPEC §5.7](spec/SPEC.md#57-objects).
- `ext.run(host=...)` connects and stays connected. With no address it uses the first Infinity Core found on the
  network (this needs the `discovery` extra).

A handler may be an `async def` function or a plain one. One that raises is logged (the Python logger
`infinity_core_api`, or `console.error` in JS) and the extension carries on.

The same in JavaScript:

```js
// what-plays.mjs
import { Extension } from 'infinity-core-api'

const ext = new Extension({
  id: 'org.example.what-plays', name: 'What Plays', version: '1.0.0', publisher: 'you',
  description: 'Prints what each zone plays.', uses: ['read'],
})

const secondsIn = (np) => np.playing ? np.position + (Date.now() - np.at) / 1000 : np.position
function show(zone) {
  const np = zone.nowPlaying
  let line = `${zone.name}: ${zone.state}`
  if (np) line += ` - ${np.track.title} · ${np.track.artists.join(', ')} (${secondsIn(np).toFixed(0)} s)`
  if (zone.private) line += ' (private session)'
  console.log(line)
}

ext.onState((s) => { if (s === 'waiting') console.log('Open Infinity Core › Settings › Extensions and enable What Plays.') })
ext.onReady(async (grant) => {
  console.log('Enabled. Acting as:', grant.actsAs)
  const now = await ext.subscribe(['zone.changed'])
  for (const zone of now.zones ?? []) show(zone)
})
ext.on('zone.changed', ({ zone }) => show(zone))

await ext.run({ host: process.argv[2] ?? '' })
```

The ready-made version of this is [examples/now-playing](examples/now-playing).

## 3. Run it and enable it

Start it with Infinity Core's address (a name like `living-room.local` or an IP address):

```sh
python3 what_plays.py 192.168.1.20
node what-plays.mjs 192.168.1.20
```

It prints `Open Infinity Core › Settings › Extensions and enable What Plays.` Now, as the Owner:

1. Open Infinity Core › **Settings › Extensions**. Your extension is in the list as **Program on 192.168.1.x**, with
   the state **Waiting for you**. The page reads the list again every few seconds, so it appears by itself.
2. Press **Review**. The dialog shows what it wants to do (one tick box per scope, in plain words), what it gives
   Infinity Core, and **Acts as**:
   - **one profile**: it sees and controls only that profile's music;
   - **Everyone**: it sees every profile's zones, and must name a zone in each call that changes something.
3. Press **Enable**. Or **Not now**: then the row is **Off** until the Owner enables it.

The program prints `Enabled.` and the zones. Infinity Core gave it a token, which the SDK keeps (section 9), so the
next start needs no Enable.

The Owner may untick any scope before pressing Enable, so check `grant["scopes"]` before you use one. The
`library.manage` scope (delete playlists, clear History, hide albums) starts unticked, even when you ask for it
([SPEC §3.2](spec/SPEC.md#32-the-answer)).

Row states you will see: **Waiting for you** · **Working** · **Working · asks for more** · **Not connected · last
seen …** · **Not answering · tries again soon** · **Blocked by Infinity Core: …** · **Off**.

## 4. A second extension: lyrics

Now an extension that gives Infinity Core something: lyrics from your own folder of `.lrc` files. It uses no scopes
at all, so it sees nothing but the questions Infinity Core asks it.

```python
# my_lyrics.py
import asyncio
import os
import re
import sys

import infinity_core_api as ica

FOLDER = os.path.expanduser(os.environ.get("LYRICS_FOLDER", "~/Lyrics"))

ext = ica.Extension(
    id="org.example.my-lyrics",
    name="My Lyrics",
    version="1.0.0",
    publisher="you",
    description="Lyrics from my own .lrc files.",
    provides=["lyrics", "status"],       # the services it gives (SPEC §7)
)


def safe(name):
    return name.replace("/", "_").replace("\\", "_")   # a title is not a path


def find(artist, title):
    for name in (f"{artist} - {title}.lrc", f"{title}.lrc"):
        path = os.path.join(FOLDER, safe(name))
        if os.path.isfile(path):
            with open(path, encoding="utf-8", errors="replace") as f:
                return f.read()
    return None


@ext.provide("lyrics.get")
async def lyrics(p):                      # {title, artist, album?, duration}
    text = await asyncio.to_thread(find, p.get("artist", ""), p["title"])
    if text is None:
        return None                       # "nothing": not an error
    if re.search(r"^\[\d+:\d+", text, re.M):
        return {"synced": text}           # "[mm:ss.xx] line" lines
    return {"plain": text}


@ext.on_ready
async def ready(grant):
    count = len([f for f in os.listdir(FOLDER) if f.endswith(".lrc")]) if os.path.isdir(FOLDER) else 0
    await ext.notify("status.set", {"message": f"{count} lyrics files", "error": count == 0})


asyncio.run(ext.run(host=sys.argv[1] if len(sys.argv) > 1 else ""))
```

- `provides=[...]` lists the services you give. The Owner sees them in the Enable dialog.
- `@ext.provide("lyrics.get")` answers Infinity Core's call. The question and answer are in
  [SPEC §7.1](spec/SPEC.md#71-lyrics): return `{"synced": …}`, `{"plain": …}`, `{"instrumental": True}`, or `None`
  for "nothing". `duration` is in seconds.
- Infinity Core waits 5 s for lyrics, 9 s for searches and 12 s for anything else, then goes on without you. It asks no
  more than 2 requests a second ([SPEC §7](spec/SPEC.md#7-services-you-provide-core--extension)). Do slow work off the
  event loop, as `asyncio.to_thread` does here.
- `status.set` puts one line (at most 80 characters) in your row in Settings
  ([SPEC §7.9](spec/SPEC.md#79-status)). `error: true` marks it as a problem. Infinity Core keeps it only for this
  connection, so send it from `on_ready`.

The JavaScript handler has the same shape:

```js
ext.provide('lyrics.get', async ({ title, artist = '' }) => {
  const text = await findLyrics(artist, title)   // your own lookup
  if (!text) return null
  return /^\[\d+:\d+/m.test(text) ? { synced: text } : { plain: text }
})
```

A fuller version that indexes sub-folders is [examples/lyrics-from-folder](examples/lyrics-from-folder).

### Try it with the Test button

Run it, enable it as in section 3, then press **Test** on its row. Fill in a title and artist and press **Run test**.
The dialog shows **What was sent**, **Its answer**, and how long it took. "It has nothing for this" means you answered
`None`. The Test button appears for `lyrics`, `album_info`, `artist_info`, `cover` and `radio`.

Under the list, **Where Infinity Core looks** shows the order of the sources. For lyrics, the song's own lyrics (an
`.lrc` file beside it, or its lyrics tag) always come first; then each source is tried top to bottom, and the first
that has the song wins. The Owner moves yours up or down with the arrows.

## 5. A settings dialog

Declare `settings` in `provides` and answer two calls. Infinity Core draws the dialog behind the **Settings** button
on your row; your extension keeps the values ([SPEC §7.10](spec/SPEC.md#710-settings)).

```python
import json
import os

SETTINGS = os.path.join(ext.state_dir, "settings.json")
settings = {"folder": "~/Lyrics", "synced_only": False, "api_key": ""}


def load_settings():
    try:
        with open(SETTINGS) as f:
            settings.update(json.load(f))
    except (OSError, ValueError):
        pass


def save_settings():
    os.makedirs(os.path.dirname(SETTINGS), exist_ok=True)
    with open(SETTINGS, "w") as f:
        json.dump(settings, f)


@ext.provide("settings.get")
async def settings_get(p):
    return {
        "layout": [
            {"id": "folder", "label": "Lyrics folder", "type": "text"},
            {"id": "synced_only", "label": "Synced lyrics only", "type": "toggle"},
            {"id": "api_key", "label": "Service key", "type": "secret", "help": "From your account page."},
        ],
        # a secret is never sent back: null means "kept"
        "values": {**settings, "api_key": None if settings["api_key"] else ""},
    }


@ext.provide("settings.save")
async def settings_save(p):
    values = p["values"]
    if not os.path.isdir(os.path.expanduser(values.get("folder") or "")):
        return {"errors": {"folder": "There is no such folder."}}
    for key, value in values.items():
        if key in settings and value is not None:   # null = unchanged secret
            settings[key] = value
    await asyncio.to_thread(save_settings)
    return {}
```

Field types are `text`, `secret`, `toggle`, `choice` (with `options`) and `number` (with `min` / `max`). Give
`choice` options string values: the dialog sends the chosen value back as a string. Call `load_settings()` before
`ext.run(...)`.

When `settings.save` answers `{"errors": {field: message}}`, the dialog shows each message under its field and stays
open. A message for an id that is not in the layout shows at the bottom of the dialog.

## 6. Menu items in ⋯ menus

With `actions` in `provides`, you can add items to the ⋯ menus of tracks, albums and artists
([SPEC §7.6](spec/SPEC.md#76-actions)). Send the list with `actions.set`, a notification, from `on_ready` (Infinity
Core keeps it only for this connection). At most 10 items; a label is at most 40 characters.

```python
from urllib.parse import quote


@ext.on_ready
async def ready(grant):
    await ext.notify("actions.set", {"actions": [
        {"id": "musicbrainz", "label": "Find on MusicBrainz", "on": ["album", "artist"]},
    ]})


@ext.provide("actions.run")
async def run_action(p):                  # {action, target: {kind, id, title, artist?, album?}}
    t = p["target"]
    kind = "release" if t["kind"] == "album" else "artist"
    return {"open": f"https://musicbrainz.org/search?type={kind}&query={quote(t['title'])}"}
```

The items appear under a divider in those menus, each with your extension's name; the menus read the list every 30
seconds or so. Return `{"message": …}` to show a short note, `{"open": url}` to open an https address in the browser,
or both.

## 7. Using Infinity Core

`ext.call(method, params)` calls any method in [SPEC §5](spec/SPEC.md#5-methods-extension--core) that your scopes allow
([SPEC §4](spec/SPEC.md#4-scopes)). A refusal raises `ica.Error` with a code from
[SPEC §9](spec/SPEC.md#9-errors).

```python
zones = (await ext.call("zones.list"))["zones"]
try:
    await ext.call("transport.control", {"zone": zones[0]["id"], "action": "pause"})   # needs "control"
except ica.Error as e:
    if e.code == -32003:
        print("Not allowed: ask for the control scope, or the zone belongs to another profile")
    else:
        raise
```

- Ids are opaque strings: keep them and give them back. They are never file paths.
- An extension that acts as one profile may leave `zone` out to mean that profile's zone. An **Everyone** extension
  must pass `zone` in every call that changes something.
- Respect private sessions: a zone with `"private": true` plays in private. Do not record, scrobble or send on what it
  plays.
- Infinity Core allows bursts of 100 calls, then 20 a second on average. Past that it answers `-32029`.

To ask for more later, add the scope or service and restart. The old grant keeps working, the answer carries
`"pending": [...]`, and the row says **Working · asks for more**. When the Owner presses **Review › Allow**,
`on_ready` runs again with the new grant.

To give amp volume and power, see [examples/amp-volume](examples/amp-volume) and
[SPEC §7.7–7.8](spec/SPEC.md#77-volume_control): register the controls from `on_ready`, and the Owner binds them to
an output with the **Amp volume** and **Amp input** pickers on your row.

## 8. Other services you can give

| service | Infinity Core calls | SPEC | Test button |
|---|---|---|---|
| `lyrics` | `lyrics.get` | [§7.1](spec/SPEC.md#71-lyrics) | yes |
| `album_info` | `album.search`, `album.get` | [§7.2](spec/SPEC.md#72-album_info) | yes (search) |
| `artist_info` | `artist.get` | [§7.3](spec/SPEC.md#73-artist_info) | yes |
| `cover` | `cover.search` | [§7.4](spec/SPEC.md#74-cover) | yes |
| `radio` | `radio.search` | [§7.11](spec/SPEC.md#711-radio) | yes |
| `actions` | `actions.run` | [§7.6](spec/SPEC.md#76-actions) | no |
| `volume_control` | `volume_control.set` | [§7.7](spec/SPEC.md#77-volume_control) | no |
| `source_control` | `source_control.select`, `source_control.standby` | [§7.8](spec/SPEC.md#78-source_control) | no |
| `status` | — (you send `status.set`) | [§7.9](spec/SPEC.md#79-status) | no |
| `settings` | `settings.get`, `settings.save` | [§7.10](spec/SPEC.md#710-settings) | no |

`track_identify` is reserved and not used yet ([SPEC §7.5](spec/SPEC.md#75-track_identify-reserved)).

## 9. The token, the key, and what happens when

The SDK keeps two things per Infinity Core, in one file:

- the **token** Infinity Core gave when it was enabled;
- the **pin**: the SHA-256 of Infinity Core's public key, which proves on every connection that it is the same Infinity
  Core ([SPEC §2.2](spec/SPEC.md#22-the-connection)).

The file is `<state_dir>/<core key>.json`, readable by its owner only. `state_dir` defaults to
`~/.config/infinity-core-api/<your id>/`; change it with `state_dir=` (Python) or `stateDir:` (JS). The core key is
Infinity Core's id when it was found by discovery or when you pass `core_id` / `coreId`, and `<host>_<port>`
otherwise. So if you connect by address and the address changes, the SDK starts a new file and the Owner must enable
the extension again. Passing the Core's id (the `id` from `https://<host>:8931/lan/hello`) as `core_id` avoids that.

Keep the file private. Anyone with the token can act with your extension's grant.

| what happens | what your extension sees |
|---|---|
| The link drops, or Infinity Core restarts | `on_state("disconnected")` once. The SDK tries again after 1, 2, 4 … up to 60 s, sends its token, and is `enabled` again with no prompt. It subscribes again, then `on_ready` runs. |
| The Owner presses **Turn off** | `on_state("disabled")`, and Infinity Core closes the socket. The token is kept. The SDK tries again about once a minute; Infinity Core answers `disabled` each time until the Owner enables it again, so it is back within about a minute of **Enable**. |
| The Owner presses **Not now** on a waiting row | the same as Turn off, but there is no token yet. When the Owner turns the **Off** row on, the extension shows as **Waiting for you** the next time it connects, and gets its token when the Owner presses **Enable** then. |
| The Owner presses **Remove** | `on_state("removed")`. The SDK deletes the token and reconnects without one, so the row comes back as **Waiting for you**. Stop the program to make it go away. |
| You ask for more | the old grant keeps working; see section 7. |
| Infinity Core's key changes | `run()` raises `PinMismatch` and stops. It never connects to a key it does not know. |
| Infinity Core blocks the extension, or is older than your `api` | `run()` raises `Stopped` (`state` is `blocked` or `upgrade`). |

On `PinMismatch`, tell the person and stop. It is expected only when Infinity Core was reinstalled or moved to a new
computer at the same address. If they confirm that, delete that Core's file in `state_dir` (`<host>_<port>.json`, or
`<core id>.json`), start again, and enable the extension again. If they did not change anything, something else may
be answering at that address.

A second copy of an enabled extension that connects without the token (another computer, or a new container) shows a
warning in its row: "… is already enabled from 192.168.1.20. This is another copy: enable it only if you started it
yourself."

## 10. Running it on a NAS or a Raspberry Pi with Docker

This Dockerfile is based on [examples/lyrics-from-folder/Dockerfile](examples/lyrics-from-folder/Dockerfile):

```dockerfile
FROM python:3.12-alpine
RUN pip install --no-cache-dir "infinity-core-api[discovery]"
COPY my_lyrics.py /app/
# the token and the key live under $HOME/.config: keep /state on a volume
ENV LYRICS_FOLDER=/lyrics HOME=/state
ENTRYPOINT ["python", "/app/my_lyrics.py"]
```

```sh
docker build -t my-lyrics .
docker run -d --name my-lyrics --restart unless-stopped --network host \
  -v /volume1/lyrics:/lyrics:ro -v my-lyrics-state:/state my-lyrics
```

- `--network host` lets discovery work (it uses multicast DNS). If you give the address instead
  (`docker run … my-lyrics 192.168.1.20`), a normal network is fine as long as the container can reach port 8931.
- Keep the `/state` volume. Without it every new container has no token, and the Owner must enable it again.
- Mount your data read-only where you can.
- The row in Settings › Extensions shows the address of the computer the container runs on.

The same image runs anywhere Docker does.

## 11. A web source instead of a program

A web source is an address that answers plain GETs. Nothing runs at the listener's home: you host it, and people add
it by its address. It can give `lyrics`, `album_info`, `artist_info`, `cover` and `radio`, with the same answers as a
program. It cannot use Infinity Core. The contract is [SPEC §8](spec/SPEC.md#8-web-sources).

| GET | answer |
|---|---|
| `{address}/infinity-extension.json` | the manifest: `{api: 1, id, name, version, publisher, homepage?, description?, provides: [...]}` |
| `{address}/lyrics?title=&artist=&album=&duration=` | as [§7.1](spec/SPEC.md#71-lyrics) |
| `{address}/album/search?album=&artist=&tracks=` | as [§7.2](spec/SPEC.md#72-album_info) |
| `{address}/album/{id}` | as [§7.2](spec/SPEC.md#72-album_info) |
| `{address}/artist?name=&mbid=` | as [§7.3](spec/SPEC.md#73-artist_info) |
| `{address}/cover/search?album=&artist=` | as [§7.4](spec/SPEC.md#74-cover) |
| `{address}/radio/search?query=&tag=&country=` | as [§7.11](spec/SPEC.md#711-radio) |

- `404` means "nothing". Any other error, `429` and `503` included, counts as a failure: after 3 in a row Infinity
  Core leaves the web source alone for 10 minutes.
- https only. Plain http is accepted only for an address on the person's own network.
- Redirects are not followed: answer at the address itself. Answers above 1 MB are dropped.
- No cookies are sent. Infinity Core sends `User-Agent: InfinityCore/<version> (api 1)`.
- Infinity Core reads the manifest once, when the web source is added (**Check**). To give more later, the Owner
  removes it and adds it again.
- `{address}` may have a path, for example `https://lyrics.example.org/infinity`.

A small one to try at home, over http on your own network:

```python
# web_lyrics.py
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

MANIFEST = {"api": 1, "id": "org.example.web-lyrics", "name": "Web Lyrics", "version": "1.0.0",
            "publisher": "you", "description": "Lyrics we wrote ourselves.", "provides": ["lyrics"]}
LYRICS = {("the examples", "first song"): "[00:01.00] A line we made up\n[00:05.00] And another one"}


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        url = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(url.query).items()}
        if url.path == "/infinity-extension.json":
            return self.answer(200, MANIFEST)
        if url.path == "/lyrics":
            text = LYRICS.get((q.get("artist", "").casefold(), q.get("title", "").casefold()))
            return self.answer(200, {"synced": text}) if text else self.answer(404)
        self.answer(404)

    def answer(self, status, body=None):
        data = json.dumps(body).encode() if body is not None else b""
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


ThreadingHTTPServer(("0.0.0.0", 8080), Handler).serve_forever()
```

To add it, the Owner opens Settings › Extensions › **Add web source**, types the address (here
`http://192.168.1.30:8080`) and presses **Check**. Check reads only the manifest; nothing about the person or their
music is sent. Then they tick **I trust <host> with this** and press **Add**. The row has **Test**, **Turn off** and
**Remove** like a program's. For real use, put it behind https.

## 12. Testing tips

- Use the **Test** button after every change. Infinity Core keeps answers for a while (also "nothing"), so Now
  Playing may not ask your extension again at once. Test always asks.
- Answer well inside the time limits. An extension that keeps failing is left alone for a while.
- Watch the log. An exception in an event, `on_ready` or `on_state` handler is logged by the SDK (the Python logger
  `infinity_core_api`, or `console.error` in JS). An exception in a `provide` handler goes back to Infinity Core as
  error `-32603`, which Test shows.
- Try both grants: enable it as one profile, then turn it off and enable it as **Everyone**. A profile extension is
  refused another profile's zone (`-32003`).
- Turn on a private session in Infinity Core and check that you leave those plays alone.
- To test the first run again, stop the program, press **Remove**, delete its file in `state_dir`, and start it.
- Check your messages against the JSON Schema, [spec/schemas/v1.schema.json](spec/schemas/v1.schema.json).
- Never test against someone else's Infinity Core without asking them: an enabled extension sees their music.

## 13. The rules

From [SPEC §10](spec/SPEC.md#10-rules-for-extensions), in short:

- Ask only for the scopes you use, and say in your README what you do with the data.
- Respect `private: true`.
- Do not send what you see (history, library, what plays) anywhere the person did not choose.
- Do not take another product's name or look like Infinity Core's own: no "Infinity …" names.
- Lyrics and covers carry copyright: use sources that allow it. Extensions that scrape sites which forbid it are never
  listed.
- Your extension is your own work: open or closed source, free or paid, under the licence you choose.

## 14. Getting listed in Find extensions

Settings › Extensions › **Find extensions** lists extensions we have checked. Closed-source and paid ones are listed
too; paid ones are marked **Paid**. A program in the list has a **How to install** link to its homepage; a web source
has an **Add** button.

A listing needs a privacy statement, and https for a web source ([SPEC §10](spec/SPEC.md#10-rules-for-extensions)).
To be listed, ask on our Discord: [discord.gg/Z9T8VfshVs](https://discord.gg/Z9T8VfshVs). Have ready your extension's
id, name, publisher, a short description, its homepage, whether it is a program or a web source (and its address),
what it provides, whether it is paid, and the link to its privacy statement.
