# Infinity Core API

Write extensions for [Infinity Core](https://anantarultimate.com): see what plays and control it, read the library,
and give Infinity Core lyrics, album and artist information, covers, radio stations, menu items and amp control.

- **Extensions** are programs you run at home (a NAS, a Raspberry Pi, the same computer, Docker on Home Assistant or
  Umbrel). They connect to Infinity Core, and its owner switches them on in **Settings › Extensions**.
- **Web sources** are https addresses that answer a few plain GETs. People add them by address; nothing runs at home.

Infinity Core never loads your code. It runs nothing for you and starts nothing.

| | |
|---|---|
| Getting started | [GETTING_STARTED.md](GETTING_STARTED.md): from nothing to a working extension |
| The specification | [spec/SPEC.md](spec/SPEC.md) · JSON Schema [spec/schemas/v1.schema.json](spec/schemas/v1.schema.json) · [changelog](spec/CHANGELOG.md) |
| Python SDK | [sdk/python](sdk/python) — `pip install infinity-core-api` (standard library only) |
| JavaScript SDK | [sdk/js](sdk/js) — `npm i infinity-core-api` (Node 18+, no dependencies) |
| Examples | [examples](examples): now playing, lyrics from a folder, amp volume |
| Home Assistant | [Infinity-Core-HomeAssistant](https://github.com/tekchansin/Infinity-Core-HomeAssistant): each zone as a media player (HACS) |

## Five lines

```python
import asyncio, infinity_core_api as ica
ext = ica.Extension(id="org.example.hello", name="Hello", version="1.0.0", publisher="you", uses=["read"])
@ext.on_ready
async def ready(grant): print((await ext.call("zones.list"))["zones"])
asyncio.run(ext.run(host="living-room.local"))
```

Run it, open Infinity Core › Settings › Extensions, press **Review › Enable**. Test what you give Infinity Core with the
**Test** button on your extension's row.

## Rules

Ask only for the scopes you use and say in your README what you do with what you see. Respect `private: true`. Use
lyrics and cover sources that allow it. Don't name your extension so it looks like ours. See SPEC §10.

## Licence

The specification, schemas, SDKs and examples: MIT. Infinity Core itself is not open source.
Your extension is your own work: open or closed source, free or paid, under the licence you choose. To be listed
in Settings › Extensions › Find extensions, see SPEC §10.
