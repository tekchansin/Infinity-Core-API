"""Now Playing: prints what plays on each zone it may see. Uses: read.

    python3 now_playing.py living-room.local      # or no address: the first Infinity Core found (pip install zeroconf)
"""
import asyncio, sys
import infinity_core_api as ica

ext = ica.Extension(id="org.example.now-playing", name="Now Playing", version="1.0.0", publisher="example",
                    uses=["read"], description="Prints what plays.")


@ext.on_state
async def state(s, res):
    if s == "waiting":
        print("Waiting: enable it in Infinity Core › Settings › Extensions")


@ext.on_ready
async def ready(grant):
    await ext.subscribe(["zone.changed"])


@ext.on("zone.changed")
async def changed(p):
    z = p["zone"]
    np = z.get("nowPlaying")
    print(f"{z['name']}: {z['state']}" + (f" — {np['track']['title']} · {', '.join(np['track']['artists'])}" if np else ""))


asyncio.run(ext.run(host=sys.argv[1] if len(sys.argv) > 1 else ""))
