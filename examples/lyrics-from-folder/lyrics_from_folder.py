"""Lyrics from a folder: gives Infinity Core the lyrics in a folder of .lrc / .txt files — yours, on a NAS. Provides: lyrics.

A file is found by "Artist - Title.lrc", else "Title.lrc" (any case, any sub-folder). The folder is read again every hour.

    LYRICS_FOLDER=/volume1/lyrics python3 lyrics_from_folder.py living-room.local
"""
import asyncio, os, re, sys, unicodedata
import infinity_core_api as ica

FOLDER = os.environ.get("LYRICS_FOLDER", "lyrics")
index: dict[str, str] = {}


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKC", s).casefold()
    return re.sub(r"\s+", " ", re.sub(r"[^\w\s]", " ", s)).strip()


def read_folder():
    found = {}
    for root, _, files in os.walk(FOLDER):
        for f in files:
            stem, ext_ = os.path.splitext(f)
            if ext_.lower() in (".lrc", ".txt"):
                found.setdefault(norm(stem), os.path.join(root, f))
    index.clear()
    index.update(found)
    print(f"{len(index)} lyrics files in {FOLDER}")


ext = ica.Extension(id="org.example.lyrics-from-folder", name="Lyrics from a folder", version="1.0.0", publisher="example",
                    provides=["lyrics", "status"], description="Lyrics from your own folder of .lrc files.")


@ext.provide("lyrics.get")
async def lyrics(p):
    for key in (f"{p.get('artist', '')} - {p['title']}", p["title"]):
        path = index.get(norm(key))
        if path:
            text = open(path, encoding="utf-8", errors="replace").read()
            return {"synced": text} if re.search(r"^\[\d+:\d+", text, re.M) else {"plain": text}
    return None


@ext.on_ready
async def ready(grant):
    await ext.notify("status.set", {"message": f"{len(index)} lyrics files"})


async def main():
    read_folder()

    async def again():
        while True:
            await asyncio.sleep(3600)
            read_folder()
            await ext.notify("status.set", {"message": f"{len(index)} lyrics files"})

    asyncio.ensure_future(again())
    await ext.run(host=sys.argv[1] if len(sys.argv) > 1 else "")


asyncio.run(main())
