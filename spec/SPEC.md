# Infinity Core API — v1 (preview)

> **Preview.** Until a stable Infinity Core carries this API, breaking changes can still happen; they are announced in
> [CHANGELOG.md](CHANGELOG.md) and on [Discord](https://discord.gg/Z9T8VfshVs). The website's API page is built from
> this file. Licence of this specification, its schemas, SDKs and examples: MIT.

## 1. What this is

Infinity Core plays a music library and streaming services to the computer's outputs, DAPs over Infinity Link, and
network players. The Infinity Core API lets other programs work with it in two ways:

- An **extension** is a program you run anywhere at home: on a NAS, a Raspberry Pi, the same computer, or in Docker
  on Home Assistant or Umbrel. It connects to Infinity Core, and the person who owns that Core switches it on with
  **Enable** in Settings › Extensions. Once enabled it can:
  - **use** Infinity Core: see what plays, control playback, change the library, switch sound settings;
  - **provide** services to Infinity Core: lyrics, album and artist information, covers, radio stations, menu actions,
    amp volume and power.
- A **web source** is an https address that Infinity Core asks for lyrics, album / artist information or covers.
  Nothing has to run at the listener's home: the maker hosts it, and people add it by its address.

Infinity Core never loads your code. It runs nothing for you and starts nothing.

## 2. Connecting (extensions)

### 2.1 Finding Infinity Core
Infinity Core announces itself with DNS-SD as `_infinity-core._tcp.local`. Its TXT record holds:

| key | value |
|---|---|
| `v` | `1` |
| `id` | the Core's id, stable across restarts and updates |
| `pin` | base64 SHA-256 of the Core's public key (DER SubjectPublicKeyInfo) |
| `api` | `1` when this Core speaks Infinity Core API v1 (no key = no API) |

An extension may also be given an address by hand. `GET https://<host>:<port>/lan/hello` answers
`{"v":1,"id":…,"name":…,"pin":…,"api":1}` without a token (no `api` = no API).

### 2.2 The connection
- `wss://<host>:<port>/ext/v1` on the port from DNS-SD (8931 unless that is taken).
- **TLS:** Infinity Core's certificate is self-signed. Check the key against the `pin` from DNS-SD; for an address
  given by hand, keep the first key you see. If the key ever differs, stop and tell the person. The SDKs do this
  for you.
- **Messages:** [JSON-RPC 2.0](https://www.jsonrpc.org/specification) text frames, one message per frame, at most
  1 MB. Both sides send requests: you call Infinity Core's methods (§5), and Infinity Core calls the services you
  provide (§7). Events are notifications (no `id`). Batches are not used.
- **Keep-alive:** Infinity Core sends a WebSocket ping every 30 s. When the link drops, reconnect with backoff
  (1, 2, 4 … 60 s) and send `hello` again with your token.
- **First message:** send `hello` within 10 s, and keep it under 8 KB; until then nothing else is read. One computer
  may have at most 3 connections that are not enabled at once. A connection from a web page (with an `Origin`
  header) is refused: extensions are programs.
- **No audio** travels over this API.
- It is reachable wherever the port is: the home network, the same computer, and the person's own Tailscale network
  (Link Anywhere). It is **never** reachable through Infinity Core's Remote access.

## 3. Hello and Enable

### 3.1 `hello` (extension → Core, first message)
```json
{"jsonrpc":"2.0","id":1,"method":"hello","params":{
  "api": 1,
  "id": "org.example.lyrics-plus",
  "name": "Lyrics Plus",
  "version": "1.2.0",
  "publisher": "lyric-tools",
  "homepage": "https://github.com/lyric-tools/lyrics-plus",
  "description": "Synced lyrics for K-pop and J-pop releases.",
  "uses": ["read"],
  "provides": ["lyrics"],
  "token": "…"            // omitted the first time
}}
```
- `id`: reverse-DNS of a domain that is yours, the same in every version: lower-case `a`–`z`, `0`–`9`, `-` and `.`,
  at most 100 characters. `name` ≤ 40 characters, `description` ≤ 200.
- `uses`: the scopes you need (§4). `provides`: the services you offer (§7). Ask only for what you use: each one is
  shown to the person.

### 3.2 The answer
```json
{"jsonrpc":"2.0","id":1,"result":{
  "state": "enabled",
  "token": "…",                      // only when a new token was made: store it
  "grant": {"scopes": ["read"], "actsAs": {"profile": 2, "name": "Anna"}},
  "core": {"id": "…", "name": "Living room", "version": "14.1", "api": 1, "preview": true}
}}
```
`state` is one of:

| state | meaning | what to do |
|---|---|---|
| `enabled` | you may work; `grant` says what you may do | carry on |
| `waiting` | the owner has not enabled you yet (or you asked for more than before) | stay connected; `extension.state` arrives when they decide |
| `disabled` | switched off by the owner | the socket closes; try again later, quietly |
| `blocked` | blocked for everyone (see `reason`) | stop |
| `upgrade` | this Core is older than your `api` | tell the person to update Infinity Core |

- `grant.actsAs` is one profile (`{"profile": id, "name": …}`) or `"everyone"`. An extension acting as a profile sees
  and controls only that profile's music. An `"everyone"` extension sees every profile's zones and names one in each
  call that changes something.
- `grant.scopes` can be **less** than you asked for: the owner may untick any scope, and `library.manage` starts
  unticked. Check `grant.scopes` before you call.
- A grant the owner turned on while you were not connected still waits for **Enable** when you connect: a token is
  never handed out by address alone.
- If you ask for more than an existing grant, the old grant keeps working (`state: "enabled"`) until the owner
  decides. The answer then carries `"pending": ["control"]`.

### 3.3 `extension.state` (Core → extension, notification)
Sent when the owner enables, changes, disables or removes you: `{"state": …, "token"?: …, "grant"?: …}`. After
`disabled` or `removed` Infinity Core closes the socket. After `removed` your token is gone: drop it and start again
with a `hello` without one.

## 4. Scopes

| scope | what the person is told | methods |
|---|---|---|
| `read` | See what <profile> plays, has played and the library | `zones.*` reads, `outputs.list`, `queue.get`, `library.*` reads, `image.url`, `history.get`, `favorites.get`, `later.get`, `events.subscribe` |
| `control` | Play, pause, skip, change volume and the queue, move music to another output | `transport.*`, `volume.*`, `play`, `queue.*` changes, `zone.*` changes |
| `library` | Change favourites, Later and playlists | `favorites.set`, `later.*`, `playlist.*` except delete |
| `library.manage` | Delete playlists, clear History and hide albums (its own tick box, off unless ticked) | `playlist.delete`, `history.clear`, `album.hide`, `album.unhide` |
| `sound` | Switch Infinity DSP stages and EQ presets | `dsp.*`, `eq.*` |

Never available to any extension: music files and folders, tag editing, scans, Settings, accounts and keys, Sync
to DAP, updates, Remote access, profiles, logs.

## 5. Methods (extension → Core)

All ids are opaque strings: keep them and give them back. They are never file paths. Today a track is `t:<n>` (or `tidal:<n>` / `qobuz:<n>`), an album `a:<n>`, an artist `ar:<name>`, a playlist `p:<n>`, a genre `g:<name>`, a zone `z<profile>` — but read them as opaque. An `"everyone"` extension must
pass `zone` wherever a method changes something. A profile extension may leave `zone` out to mean its profile's
current zone.

### 5.1 Core
| method | params | result |
|---|---|---|
| `core.info` | — | `{id, name, version, api, preview, profiles?}`; `profiles` lists `{id, name}` for `"everyone"` extensions only |
| `events.subscribe` | `{events: [Event…]}` | the current state of each (§6), then events as they happen |
| `events.unsubscribe` | `{events: [Event…]}` | `{}` |

### 5.2 Zones, outputs, queue (`read`)
| method | params | result |
|---|---|---|
| `zones.list` | — | `{zones: [Zone]}` |
| `zone.get` | `{zone}` | `Zone` |
| `outputs.list` | — | `{outputs: [Output]}` |
| `queue.get` | `{zone, from?: 0, count?: 100}` | `{total, from, items: [Track]}` |

### 5.3 Library (`read`)
| method | params | result |
|---|---|---|
| `library.albums` | `{filter?, sort?: "name"\|"artist"\|"added"\|"year", from?, count?: 100}` | `{total, items: [Album]}` |
| `library.artists` | `{filter?, sort?, from?, count?}` | `{total, items: [Artist]}` |
| `library.genres` | `{from?, count?}` | `{total, items: [{id, name, albums}]}` |
| `library.playlists` | `{from?, count?}` | `{total, items: [Playlist]}` |
| `library.album` | `{album}` | `Album` + `{tracks: [Track]}` |
| `library.artist` | `{artist}` | `Artist` + `{albums: [Album]}` |
| `library.playlist` | `{playlist, from?, count?}` | `Playlist` + `{total, items: [Track]}` |
| `library.track` | `{track}` | `Track` |
| `library.search` | `{query, kinds?: ["track","album","artist","playlist"], count?: 20}` | `{tracks, albums, artists, playlists}` |
| `image.url` | `{image, size?: 600}` | `{url, expires}`: an https address on the Core, valid 10 minutes, no token needed |
| `history.get` | `{from?, count?: 100}` | `{total, items: [{track: Track, at}]}`; private plays left out |
| `favorites.get` | `{kind?: "track"\|"album"\|"artist", from?, count?}` | `{total, items: [Track\|Album\|Artist]}` |
| `later.get` | `{from?, count?}` | `{total, items: [{id, kind, title?, artist?, added}]}`: `id` is for `later.remove` |

`filter` is free text matched like the library's own filter box.

### 5.4 Playback (`control`)
| method | params | result |
|---|---|---|
| `transport.control` | `{zone?, action: "play"\|"pause"\|"playpause"\|"stop"\|"next"\|"previous"}` | `{}` |
| `transport.seek` | `{zone?, position}` (seconds) or `{zone?, by}` (± seconds) | `{}` |
| `volume.set` | `{zone?, value}` or `{zone?, by}`: the zone's output, in its own unit (§5.7) | `Volume` |
| `volume.mute` | `{zone?, mute: true\|false}` | `Volume` |
| `play` | `{zone?, items: [id…], mode?: "now"\|"next"\|"later", shuffle?: false}`; `items` = track ids, or one album or playlist id | `{}` |
| `queue.play` | `{zone?, position}`: play from that place in the queue | `{}` |
| `queue.move` | `{zone?, from, to}` (positions) | `{}` |
| `queue.remove` | `{zone?, positions: [n…]}` | `{}` |
| `queue.clear` | `{zone?}`: what is still to come | `{}` |
| `zone.shuffle` | `{zone?, on}` | `{}` |
| `zone.repeat` | `{zone?, mode: "off"\|"all"\|"one"}` | `{}` |
| `zone.transfer` | `{zone?, to: output}`: the music goes on from the same place on another output or DAP | `Zone` |
| `zone.sleep` | `{zone?, minutes}` (0 = off) | `{}` |

### 5.5 Library changes (`library`, `library.manage`)
| method | scope | params |
|---|---|---|
| `favorites.set` | library | `{item, favorite: true\|false}` |
| `later.add` / `later.remove` | library | `{item}`: a track, album, artist (`ar:`), playlist or genre id; `later.remove` also takes a `later.get` id |
| `playlist.create` | library | `{name, items?: [id…]}` → `Playlist` |
| `playlist.rename` | library | `{playlist, name}` |
| `playlist.add` | library | `{playlist, items: [id…], at?}` |
| `playlist.remove` | library | `{playlist, positions: [n…]}` |
| `playlist.reorder` | library | `{playlist, from, to}` |
| `playlist.delete` | library.manage | `{playlist}`: removes its `.m3u` file too |
| `history.clear` | library.manage | `{}` |
| `album.hide` / `album.unhide` | library.manage | `{album}` |

### 5.6 Sound (`sound`)
| method | params | result |
|---|---|---|
| `dsp.get` | `{zone?}` | `{stages: [{id, name, on}]}` |
| `dsp.set` | `{zone?, stage: "invert"\|"vinyl"\|"tube"\|"chassis"\|"crossfeed", on}` | the same as `dsp.get` |
| `eq.get` | `{zone?}` | `{graphic: {on, preset, presets: [name]}, peq: {on, profile, profiles: [name]}}` |
| `eq.set` | `{zone?, graphic?: {on?, preset?}, peq?: {on?, profile?}}` | the same as `eq.get` |

Switching only: presets and stages are made and tuned in Infinity Core.

### 5.7 Objects
```
Zone     {id, name, profile: {id, name}, state: "playing"|"paused"|"stopped"|"loading",
          output: Output, nowPlaying?: NowPlaying, queue: {total, position},
          shuffle: bool, repeat: "off"|"all"|"one", private: bool}
NowPlaying {track: Track, position, at, playing}   // position in s at the Core's clock `at` (ms since epoch)
Output   {id, name, kind: "computer"|"dap"|"upnp"|"cast"|"airplay"|"extension", volume?: Volume, inUse?: {profile}}
Volume   {value, min, max, step, unit: "dB"|"percent"|"steps", muted, fixed}   // fixed: line out, no control
Track    {id, title, artists: [string], album?: {id, title}, albumArtist?, disc?, number?, duration,
          source: "library"|"tidal"|"qobuz"|"radio"|…, quality?: {format, sampleRate, bitDepth}, image?}
Album    {id, title, artist, year?, tracks?, source, image?}
Artist   {id, name, image?}
Playlist {id, name, tracks, image?, editable}
```
Fields may be added in any version: ignore what you do not know. `image` is an image id for `image.url`.

## 6. Events (Core → extension, notifications)

Subscribe with `events.subscribe`. You receive only what you subscribed to.

| event | params | sent when |
|---|---|---|
| `zone.changed` | `{zone: Zone}` | state, track, output, volume, shuffle / repeat changes; play, pause or seek |
| `zone.removed` | `{zone: "<id>"}` | a zone goes away (its profile was removed) |
| `queue.changed` | `{zone, total, position}` | the queue changes (fetch it with `queue.get`) |
| `outputs.changed` | `{outputs: [Output]}` | an output appears, goes or changes |
| `library.changed` | `{}` | the library changed (fetch what you need) |

- **Position is not sent every second.** `nowPlaying.position` is true at `at`. While `playing`, count on from
  there. A new `zone.changed` comes on play, pause, seek and a new track.
- **Private session:** a zone with `private: true` plays in private. Do not record, scrobble or send on what it
  plays. `history.get` already leaves those plays out.

## 7. Services you provide (Core → extension)

Declare them in `hello.provides`. Infinity Core calls them only after you are enabled, and only when they are needed.
Answer `null` when you have nothing: that is not an error. Infinity Core waits **5 s** for lyrics, **9 s** for
searches and **12 s** for anything else, then goes on without you. It also asks no more than 2 requests a second.

### 7.1 `lyrics`
`lyrics.get` `{title, artist, album?, duration}` → `{synced?: "[mm:ss.xx] line\n…", plain?: "…", instrumental?: true}` or `null`

### 7.2 `album_info`
- `album.search` `{album, artist?, tracks?}` → `{results: [{id, album, artist, year?, tracks?, cover?}]}`
- `album.get` `{id}` (an id from your own search) → `{album, albumArtist, date?, label?, genre?: [string], cover?,
  tracks: [{disc, number, title, artist, durationMs}]}`

### 7.3 `artist_info`
`artist.get` `{name, mbid?}` → `{name, bio?: {text, url?, lang}, image?: url, members?: [{name, from?, to?}],
born?, formed?, links?: [{label, url}]}` or `null`

### 7.4 `cover`
`cover.search` `{album, artist?}` → `{results: [{url, width, height, label?}]}`

### 7.5 `track_identify` (reserved)
Not used by Infinity Core yet: the name and shape are kept for a later version. Until then Infinity Core ignores it.

`track.identify` `{fingerprint, duration}` → `{results: [{score, title, artist, album?, albumId?}]}`
- `fingerprint` is a Chromaprint fingerprint (compressed, base64), as `fpcalc` prints it.
- `albumId`, when you give one, must work with your own `album.get`.
- Connected extensions only: there is no web-source form.

### 7.6 `actions`
- Send `actions.set` (extension → Core, notification) `{actions: [{id, label, on: ["track","album","artist"]}]}`
  whenever your list changes. The items appear in those ⋯ menus under your extension's name.
- When one is chosen, Infinity Core calls `actions.run` `{action, target: {kind, id, title, artist?, album?}}` →
  `{message?, open?: url}`. `message` is shown for a moment; `open` is opened in the browser.

### 7.7 `volume_control`
- `volume_control.register` (ext → Core) `{id, name, value, min, max, step, unit, muted}`. The owner then binds it to
  an output in your settings.
- Core → `volume_control.set` `{id, value?, by?, mute?}` → the new `{value, muted}`.
- Changes made at the device itself: send `volume_control.update` (notification) `{id, value, muted}`.

### 7.8 `source_control`
- `source_control.register` `{id, name, standby: bool}`. It is bound to an output the same way.
- Core → `source_control.select` `{id}` when that output starts playing, and `source_control.standby` `{id}` when it
  has been idle as long as the owner chose.

### 7.11 `radio`
`radio.search` `{query?, tag?, country?}` → `{stations: [{id, name, url, logo?, country?, tags?, codec?, bitrate?, homepage?}]}`
- An empty query = the stations you would show first. Infinity Core lists them in Live Radio beside its own and plays
  `url` itself (http or https; an .m3u / .pls address is read for the stream in it).
- Infinity Core asks it again at most once an hour for the same question.

### 7.9 `status`
`status.set` (ext → Core, notification) `{message, error?: false}`: one line in your row in Settings (≤ 80
characters).

### 7.10 `settings`
- Core → `settings.get` → `{layout: [Field], values: {…}}`; Core → `settings.save` `{values}` → `{}` or
  `{errors: {field: "message"}}`. You keep the values.
- `Field` = `{id, label, type: "text"|"secret"|"toggle"|"choice"|"number", help?, options?: [{value, label}], min?,
  max?}`. A `secret` is never shown again after saving: send it back as `null`, which means unchanged.

## 8. Web sources

A web source answers plain https GETs. People add it by its address in Settings › Extensions › Add web source.

| GET | answer |
|---|---|
| `{address}/infinity-extension.json` | `{api: 1, id, name, version, publisher, homepage?, description?, provides: ["lyrics"\|"album_info"\|"artist_info"\|"cover"\|"radio"]}` |
| `{address}/lyrics?title=&artist=&album=&duration=` | as §7.1 |
| `{address}/album/search?album=&artist=&tracks=` | as §7.2 |
| `{address}/album/{id}` | as §7.2 |
| `{address}/artist?name=&mbid=` | as §7.3 |
| `{address}/cover/search?album=&artist=` | as §7.4 |
| `{address}/radio/search?query=&tag=&country=` | as §7.11 |

- `404` means "nothing". Any other error, `429` / `503` included, counts as a failure: after 3 in a row Infinity Core
  leaves the web source alone for 10 minutes.
- https only. Plain http is accepted only for an address on the person's own network.
- Redirects are not followed: answer at the address itself. No cookies are sent. Answers above 1 MB are dropped.
- `User-Agent: InfinityCore/<version> (api 1)`.
- Infinity Core reads the manifest when the web source is added (Check). To give more later, the owner removes it
  and adds it again.

## 9. Errors

Standard JSON-RPC codes plus:

| code | meaning |
|---|---|
| `-32001` | not enabled (yet) |
| `-32003` | not allowed: outside your grant, or a zone of another profile |
| `-32004` | not found (an id that no longer exists) |
| `-32009` | that output is in use by another profile |
| `-32010` | not possible on this output (e.g. a fixed volume) |
| `-32029` | too many requests: slow down (bursts of 100, then 20 a second on average) |

## 10. Rules for extensions
- Ask only for the scopes you use, and say in your README what you do with the data.
- Respect `private: true`.
- Do not send what you see (history, library, what plays) anywhere the person did not choose.
- Do not take another product's name or look like Infinity Core's own (no "Infinity …" names).
- Lyrics and covers carry copyright: use sources that allow it. Extensions that scrape sites which forbid it are
  never listed by us.
- Your extension is your own work: open or closed source, free or paid, under the licence you choose. Find
  extensions lists closed-source and paid ones too (paid ones are marked **Paid**); a listing needs a privacy
  statement, and https for a web source. Ask on our Discord: discord.gg/Z9T8VfshVs.

## 11. Versions
- `api: 1` grows only by adding things: new methods, events, fields and services. Ignore what you do not know.
- A breaking change becomes `api: 2`. Infinity Core then keeps answering v1 for at least 12 months.
- While `core.info.preview` is `true`, v1 itself can still change. Watch `CHANGELOG.md`.
