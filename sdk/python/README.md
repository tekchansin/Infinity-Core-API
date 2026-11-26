# infinity-core-api (Python)

The Infinity Core API for Python 3.9 or newer. One file, `infinity_core_api.py`, standard library only (asyncio +
ssl). It works in plain scripts and inside Home Assistant. The specification is [SPEC.md](../../spec/SPEC.md); the
tutorial is [GETTING_STARTED.md](../../GETTING_STARTED.md).

## Install

```sh
pip install infinity-core-api                 # the SDK
pip install "infinity-core-api[discovery]"    # also find Infinity Core on the network (adds zeroconf >= 0.120)
pip install .                                 # from this folder
```

Or copy `infinity_core_api.py` next to your script.

## Quick start

```python
import asyncio
import infinity_core_api as ica

ext = ica.Extension(id="org.example.lyrics", name="My Lyrics", version="1.0.0", publisher="you",
                    provides=["lyrics"])


@ext.provide("lyrics.get")
async def lyrics(p):          # {title, artist, album?, duration}
    return {"plain": "…"}     # or {"synced": "[00:12.40] …"}, or None for "nothing"


asyncio.run(ext.run(host="living-room.local"))
```

Run it, then in Infinity Core › Settings › Extensions press **Review › Enable**.

## What the module exports

| name | what it is |
|---|---|
| `Extension` | one extension: its description, handlers, and the connection |
| `Error` | a JSON-RPC error answer |
| `PinMismatch` | Infinity Core's key is not the one we know |
| `Stopped` | Infinity Core will not work with this extension |
| `discover()` | find Infinity Cores on the network |
| `pin_of()` | the pin of a certificate |
| `API` | `1`, the API version this SDK speaks |
| `DEFAULT_PORT` | `8931` |

## `Extension`

```python
ica.Extension(*, id, name, version, publisher, uses=(), provides=(), homepage="", description="", state_dir="")
```

All arguments are keywords. They become the `hello` Infinity Core shows to the Owner
([SPEC §3.1](../../spec/SPEC.md#31-hello-extension--core-first-message)).

| argument | default | meaning |
|---|---|---|
| `id` | required | reverse-DNS, yours, the same in every version: lower-case letters, digits, `-` and dots, e.g. `org.example.my-lyrics` |
| `name` | required | shown in Settings › Extensions; at most 40 characters |
| `version` | required | your version, e.g. `"1.2.0"` |
| `publisher` | required | you or your organisation |
| `uses` | `()` | the scopes you need: `read`, `control`, `library`, `library.manage`, `sound` ([SPEC §4](../../spec/SPEC.md#4-scopes)) |
| `provides` | `()` | the services you give: `lyrics`, `album_info`, `artist_info`, `cover`, `radio`, `actions`, `volume_control`, `source_control`, `status`, `settings` ([SPEC §7](../../spec/SPEC.md#7-services-you-provide-core--extension)) |
| `homepage` | `""` | an http(s) address; left out of `hello` when empty |
| `description` | `""` | at most 200 characters; left out when empty |
| `state_dir` | `~/.config/infinity-core-api/<id>/` | where the token and the key are kept (see [Saved state](#saved-state)) |

### Attributes

| attribute | meaning |
|---|---|
| `ext.info` | the `hello` parameters (without the token) |
| `ext.state_dir` | the folder for the saved state |
| `ext.state` | the last state: starts as `"disconnected"`; see [States](#states) |
| `ext.grant` | the last grant, `{"scopes": [...], "actsAs": {"profile": id, "name": ...} or "everyone"}`; `{}` until enabled. It is not cleared on disconnect, Turn off or Remove. |
| `ext.core` | Infinity Core's details from the last answer: `{id, name, version, api, preview, profiles?}` |

### Decorators

A handler may be an `async def` function or a plain function; the SDK awaits it when it returns an awaitable. A
plain function runs on the event loop, so keep it short.

An exception in an event, `on_ready` or `on_state` handler is logged on the `infinity_core_api` logger (see
[Logging](#logging)) and never ends `run()`; the other handlers still run. An exception in a `provide` handler
becomes the error answer (below).

#### `@ext.on(event)`

```python
@ext.on("zone.changed")
async def changed(params): ...
```

Calls `handler(params)` for each notification `event` from Infinity Core. Several handlers may share an event; they
run in the order they were added. Use it for the events in [SPEC §6](../../spec/SPEC.md#6-events-core--extension-notifications)
(subscribe to them with `subscribe()`), and for `extension.state`, which reaches your handler after the SDK has
handled it.

`on(event)` returns a decorator, so the call form is `ext.on("zone.changed")(handler)`.

#### `@ext.provide(method)`

```python
@ext.provide("lyrics.get")
async def lyrics(params): ...
```

Answers a call from Infinity Core. One handler per method; a second one replaces the first. The handler gets the
call's `params` (`{}` when there are none) and returns the result:

- return a JSON value: it is the answer;
- return `None`: the answer is `null`, which means "nothing" and is not an error;
- raise `ica.Error(code, message)`: the answer is that error (its `data` is not sent);
- raise anything else: the answer is error `-32603` with the first 200 characters of the exception's text.

A call to a method with no handler is answered `-32601` ("not provided: <method>"). Infinity Core calls only the
services in `provides`, so declare them there too. Each call runs as its own task, so several may run at once.

The methods Infinity Core calls:

| service | method | params → result |
|---|---|---|
| `lyrics` | `lyrics.get` | [SPEC §7.1](../../spec/SPEC.md#71-lyrics) |
| `album_info` | `album.search`, `album.get` | [SPEC §7.2](../../spec/SPEC.md#72-album_info) |
| `artist_info` | `artist.get` | [SPEC §7.3](../../spec/SPEC.md#73-artist_info) |
| `cover` | `cover.search` | [SPEC §7.4](../../spec/SPEC.md#74-cover) |
| `radio` | `radio.search` | [SPEC §7.11](../../spec/SPEC.md#711-radio) |
| `actions` | `actions.run` | [SPEC §7.6](../../spec/SPEC.md#76-actions) |
| `volume_control` | `volume_control.set` | [SPEC §7.7](../../spec/SPEC.md#77-volume_control) |
| `source_control` | `source_control.select`, `source_control.standby` | [SPEC §7.8](../../spec/SPEC.md#78-source_control) |
| `settings` | `settings.get`, `settings.save` | [SPEC §7.10](../../spec/SPEC.md#710-settings) |

#### `@ext.on_ready`

```python
@ext.on_ready
async def ready(grant): ...
```

Calls `handler(grant)` each time the state becomes `enabled`: after `hello` on every connection (so after every
reconnect), and when the Owner enables the extension or allows more while it is connected. Subscriptions made
with `subscribe()` are already restored when it runs. Do your set-up here: subscribe, and send `status.set`,
`actions.set` and `volume_control.register` / `source_control.register`, which Infinity Core keeps only for the
current connection.

Several `on_ready` handlers may be added; they run in order. It returns the function, so it also works as
`ext.on_ready(fn)`.

#### `@ext.on_state`

```python
@ext.on_state
async def state(state, result): ...
```

Calls `handler(state, result)` on every state change. `result` is the `hello` answer or the `extension.state`
parameters, so it may hold `token`, `grant`, `core`, `pending` and `reason`. It may carry the token: do not log it
whole. It returns the function, so it also works as `ext.on_state(fn)`.

### States

| state | when | `result` | what the SDK does |
|---|---|---|---|
| `"waiting"` | the Owner has not enabled it yet | `{state, core}` | stays connected; `extension.state` arrives when the Owner decides |
| `"enabled"` | you may work | `{state, grant, core, token?, pending?}` | saves a new token, restores subscriptions, runs `on_ready` |
| `"disabled"` | turned off by the Owner (or **Not now**) | `{state, reason?}` | Infinity Core closes the socket; the SDK keeps the token and tries again after about 60 s, each time |
| `"removed"` | removed by the Owner | `{state}` | deletes the saved token; reconnects without one, so the extension is waiting again |
| `"blocked"` | blocked for everyone | `{state, reason}` | `run()` raises `Stopped` |
| `"upgrade"` | this Infinity Core is older than `api` 1 | `{state}` | `run()` raises `Stopped` |
| `"disconnected"` | the connection dropped | `{}` | sent once per drop; `run()` reconnects by itself |

`"disconnected"` is not sent when a connection attempt fails while the state is already `"disconnected"`, so it comes
once, not on every retry. `pending` lists what you asked for beyond the current grant; the old grant keeps working
until the Owner decides ([SPEC §3.2](../../spec/SPEC.md#32-the-answer)).

### Methods

#### `await ext.run(host="", port=8931, pin="", core_id="")`

Connects and stays connected. It never returns normally.

| argument | meaning |
|---|---|
| `host` | Infinity Core's address. Empty: `discover()` is run, and the first Infinity Core found is used from then on. |
| `port` | the port; 8931 unless Infinity Core announces another |
| `pin` | the key pin to require (DNS-SD `pin`). Empty: the saved pin, or else the first key seen is kept. |
| `core_id` | Infinity Core's id. It names the saved-state file; empty means `<host>_<port>`. Discovery fills it in. |

On a dropped link, a refused connection, a TLS or WebSocket error, or a timeout, it waits and tries again: about 1, 2,
4 … up to 60 s, plus up to 1 s at random. After a connection that ended without an error the wait goes back to 1 s,
except when it ended in `disabled` (Turn off or Not now): then it waits 60 s ("try again later, quietly",
[SPEC §3.2](../../spec/SPEC.md#32-the-answer)). Each new connection checks the key, sends `hello` with the saved
token, and handles the answer as in [States](#states).

It raises:

- `PinMismatch`: the key is not the expected one. It does not try again.
- `Stopped`: the answer was `blocked` or `upgrade`.
- `Error`: Infinity Core refused the `hello` itself, e.g. `-32602` for an `id` that is not reverse-DNS or an empty
  `name`.
- `RuntimeError`: no `host` and no `zeroconf` package.

When Infinity Core refuses the SDK's own `events.subscribe` after a new `hello` (for example `-32003` once `read` is
no longer granted), the SDK logs a warning and carries on.

Errors in your handlers never end `run()`: they are logged.

Cancelling the task that runs `run()` closes the socket.

#### `await ext.call(method, params=None, timeout=30)`

Calls an Infinity Core method ([SPEC §5](../../spec/SPEC.md#5-methods-extension--core)) and returns its `result`.
`params` is left out when `None`.

It raises:

- `Error`: an error answer, e.g. `-32001` not enabled yet, `-32003` not allowed, `-32029` too many requests
  ([SPEC §9](../../spec/SPEC.md#9-errors));
- `ConnectionError("not connected")`: there is no connection now;
- `ConnectionError("disconnected")`: the link dropped before the answer. It is raised as soon as the socket closes,
  not after the timeout;
- `asyncio.TimeoutError`: no answer within `timeout` seconds.

#### `await ext.notify(method, params=None)`

Sends a notification: no answer comes back. It does nothing when there is no connection. Use it for:

| method | params | SPEC |
|---|---|---|
| `status.set` | `{message, error?}`: one line, at most 80 characters | [§7.9](../../spec/SPEC.md#79-status) |
| `actions.set` | `{actions: [{id, label, on: ["track","album","artist"]}]}` | [§7.6](../../spec/SPEC.md#76-actions) |
| `volume_control.register` | `{id, name, value, min, max, step, unit, muted}` | [§7.7](../../spec/SPEC.md#77-volume_control) |
| `volume_control.update` | `{id, value, muted}` | [§7.7](../../spec/SPEC.md#77-volume_control) |
| `source_control.register` | `{id, name, standby}` | [§7.8](../../spec/SPEC.md#78-source_control) |

Infinity Core keeps these for the current connection only, so send them from `on_ready`. It ignores `actions.set`
and the `*_control.*` ones until the extension is enabled with that service in `provides`.

#### `await ext.subscribe(events)`

Subscribes to events (`zone.changed`, `zone.removed`, `queue.changed`, `outputs.changed`, `library.changed`) and
returns the answer of `events.subscribe`: the current state of what you asked for
([SPEC §5.1](../../spec/SPEC.md#51-core)). For `zone.changed` it holds a `zones` list, for `outputs.changed` an
`outputs` list.

The SDK remembers every event you subscribe to and subscribes again, before `on_ready`, each time the state becomes
`enabled`. That repeat's answer is not passed on, so read the current state from your own `subscribe()` call in
`on_ready`.

Events are remembered only once Infinity Core accepted them: a `subscribe()` that fails (for example without `read`)
leaves nothing behind.

#### `await ext.unsubscribe(events)`

Stops events: it removes them from the remembered list, so a reconnect does not subscribe them again, and calls
`events.unsubscribe`. Returns its answer, `{}`.

## Exceptions

### `Error(code, message, data=None)`

A JSON-RPC error. `e.code` (int), `e.message` (str) and `e.data` (anything, or `None`). `str(e)` is
`"<code>: <message>"`. `call()` raises it for an error answer; raise it in a `provide` handler to answer with an error.

```python
try:
    await ext.call("volume.set", {"value": -20})
except ica.Error as e:
    if e.code == -32010:      # not possible on this output, e.g. a fixed volume
        ...
```

### `PinMismatch`

Raised by `run()` when Infinity Core's key differs from the `pin` you gave, or from the one saved the first time.
The message is `"<host>: the Core's key changed. Remove the extension's saved state if this is expected."` Stop and
tell the person ([SPEC §2.2](../../spec/SPEC.md#22-the-connection)). If they reinstalled Infinity Core or moved it,
delete that Core's file in `state_dir` and start again; the Owner then enables the extension again.

### `Stopped(state, reason="")`

Raised by `run()` when Infinity Core will not work with this extension. `e.state` is `"blocked"` or `"upgrade"`;
`e.reason` is Infinity Core's reason, or `""`. On `upgrade`, tell the person to update Infinity Core.

A `blocked` that arrives while connected is not raised at once: Infinity Core closes the socket, and the next
`hello` answers `blocked`, which raises.

## Saved state

The SDK keeps one JSON file per Infinity Core: `<state_dir>/<core key>.json`, holding `{"pin": …, "token": …}`.

- `<core key>` is Infinity Core's id (from discovery, or `core_id=`), or `<host>_<port>`.
- The pin is saved the first time the SDK sees a key, when no `pin` was given. The token is saved when Infinity Core
  sends one, and deleted on `removed`.
- The file is written to a `.tmp` file first and then renamed, with mode `0600`.
- File reads and writes run in a thread (`asyncio.to_thread`), so they never block the event loop.

Keep the file private: anyone with the token can act with the extension's grant. In Docker, put `state_dir` (or
`$HOME`) on a volume.

If the file cannot be written (for example a read-only folder), the error is an `OSError`, which `run()` treats like
a lost connection: it keeps trying, and logs a warning each time. Check the folder's permissions when an extension never shows
up in Settings › Extensions.

## Discovery

### `await discover(timeout=2.0)`

Finds Infinity Cores on the network that speak this API, by DNS-SD `_infinity-core._tcp.local`
([SPEC §2.1](../../spec/SPEC.md#21-finding-infinity-core)). It listens for `timeout` seconds and returns a list of
`{"name", "host", "port", "id", "pin"}`. Cores whose TXT record has no `api=1` are left out. `host` is the first
address zeroconf reports. It needs `pip install zeroconf` (the `discovery` extra) and raises `RuntimeError` without it.

```python
cores = await ica.discover()
if cores:
    c = cores[0]
    await ext.run(host=c["host"], port=c["port"], pin=c["pin"], core_id=c["id"])
```

### `pin_of(cert_der)`

Returns the pin of a DER certificate: the base64 SHA-256 of its SubjectPublicKeyInfo, as in Infinity Core's DNS-SD
`pin`. The SDK uses it on every connection; you need it only to compare a key yourself.

## asyncio and threads

- Everything runs on one asyncio event loop. The SDK is not thread-safe: call its methods from the loop. From
  another thread, use `asyncio.run_coroutine_threadsafe(ext.call(...), loop)`.
- Do not block the loop. The SDK answers Infinity Core's WebSocket pings (every 30 s) and its calls on the same loop.
  Run slow or blocking work with `await asyncio.to_thread(fn, ...)`.
- To run other tasks beside it, start it as a task: `task = asyncio.create_task(ext.run(...))`. Cancel the task to
  stop it.
- The SDK opens TLS with `ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)`, does not check the certificate chain or the host
  name (the certificate is self-signed), and checks the pin instead. It never reads the system's CA files, which
  would block the loop.

## Logging

The SDK logs on `logging.getLogger("infinity_core_api")`: a handler that raised, with its traceback, at level
`ERROR`. Without any logging set up, Python prints it to stderr. To send it elsewhere:

```python
import logging
logging.basicConfig(level=logging.INFO)            # or configure the "infinity_core_api" logger yourself
```

That is all it logs: never a token, a pin or a message. What your exception's text says is up to you.

## Limits

One message is at most 1 MB ([SPEC §2.2](../../spec/SPEC.md#22-the-connection)). A bigger one from Infinity Core
closes the connection; keep yours under it too. No audio travels over this API.

## Licence

MIT.
