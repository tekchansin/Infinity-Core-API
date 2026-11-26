"""Amp volume: lets Infinity Core turn an amplifier's volume and switch it on. Provides: volume_control, source_control, settings.

Replace set_amp_volume() / select_input() / standby() with your amp's own call (its HTTP API, RS-232, an IR blaster…).
In Infinity Core › Settings › Extensions, bind "Amp volume" and "Amp input" to the output the amp is connected to.

    python3 amp_volume.py living-room.local
"""
import asyncio, sys
import infinity_core_api as ica

amp = {"value": -40.0, "muted": False}
settings = {"address": "192.168.1.50", "input": "Optical 1"}

ext = ica.Extension(id="org.example.amp-volume", name="Amp volume", version="1.0.0", publisher="example",
                    provides=["volume_control", "source_control", "settings"])


async def set_amp_volume(db: float):  # your amp's call here
    print(f"amp {settings['address']}: volume {db} dB")


async def select_input():
    print(f"amp {settings['address']}: on, input {settings['input']}")


async def standby():
    print(f"amp {settings['address']}: standby")


@ext.on_ready
async def ready(grant):
    await ext.notify("volume_control.register", {"id": "amp", "name": "Amplifier", "value": amp["value"], "min": -80, "max": 0,
                                                  "step": 0.5, "unit": "dB", "muted": amp["muted"]})
    await ext.notify("source_control.register", {"id": "amp-in", "name": settings["input"], "standby": True})


@ext.provide("volume_control.set")
async def vol(p):
    if "value" in p:
        amp["value"] = p["value"]
        await set_amp_volume(amp["value"])
    if "mute" in p:
        amp["muted"] = p["mute"]
    return amp


@ext.provide("source_control.select")
async def sel(p):
    await select_input()
    return {}


@ext.provide("source_control.standby")
async def sb(p):
    await standby()
    return {}


@ext.provide("settings.get")
async def sget(p):
    return {"layout": [{"id": "address", "label": "Amp address", "type": "text"},
                       {"id": "input", "label": "Input", "type": "choice",
                        "options": [{"value": "Optical 1", "label": "Optical 1"}, {"value": "Coaxial", "label": "Coaxial"}]}],
            "values": settings}


@ext.provide("settings.save")
async def sset(p):
    settings.update({k: v for k, v in p["values"].items() if v is not None})
    return {}


asyncio.run(ext.run(host=sys.argv[1] if len(sys.argv) > 1 else ""))
