# infinity-core-api (JavaScript)

The Infinity Core API for Node 18 or newer. One ES module, `index.mjs`, with no required dependencies: its own
WebSocket client on `node:tls`, with Infinity Core's key pinned. The specification is [SPEC.md](../../spec/SPEC.md);
the tutorial is [GETTING_STARTED.md](../../GETTING_STARTED.md). It has the same shape as the
[Python SDK](../python/README.md); the differences are listed [at the end](#differences-from-the-python-sdk).

## Install

```sh
npm i infinity-core-api
```

`bonjour-service` (for discovery) is an optional dependency: npm installs it unless you pass `--omit=optional`.
Without it, give Infinity Core's address. The package is ESM only: use `import`, not `require`.

## Quick start

```js
import { Extension } from 'infinity-core-api'

const ext = new Extension({ id: 'org.example.deck', name: 'My Deck', version: '1.0.0', publisher: 'you', uses: ['read', 'control'] })
ext.onReady(async () => {
  const { zones } = await ext.call('zones.list')
  await ext.call('transport.control', { zone: zones[0].id, action: 'playpause' })
})
await ext.run({ host: 'living-room.local' })
```

Run it, then in Infinity Core › Settings › Extensions press **Review › Enable**. Note that `onReady` runs again after
every reconnect, so this one toggles play / pause each time.

## What the module exports

| name | what it is |
|---|---|
| `Extension` | one extension: its description, handlers, and the connection |
| `RpcError` | a JSON-RPC error answer |
| `PinMismatch` | Infinity Core's key is not the one we know |
| `Stopped` | Infinity Core will not work with this extension |
| `discover()` | find Infinity Cores on the network |
| `pinOf()` | the pin of a certificate |
| `API` | `1`, the API version this SDK speaks |
| `DEFAULT_PORT` | `8931` |

## `Extension`

```js
new Extension({ id, name, version, publisher, uses = [], provides = [], homepage = '', description = '', stateDir = '' })
```

The fields become the `hello` Infinity Core shows to the Owner
([SPEC §3.1](../../spec/SPEC.md#31-hello-extension--core-first-message)).

| field | default | meaning |
|---|---|---|
| `id` | required | reverse-DNS, yours, the same in every version: lower-case letters, digits, `-` and dots, e.g. `org.example.my-deck` |
| `name` | required | shown in Settings › Extensions; at most 40 characters |
| `version` | required | your version, e.g. `'1.2.0'` |
| `publisher` | required | you or your organisation |
| `uses` | `[]` | the scopes you need: `read`, `control`, `library`, `library.manage`, `sound` ([SPEC §4](../../spec/SPEC.md#4-scopes)) |
| `provides` | `[]` | the services you give: `lyrics`, `album_info`, `artist_info`, `cover`, `radio`, `actions`, `volume_control`, `source_control`, `status`, `settings` ([SPEC §7](../../spec/SPEC.md#7-services-you-provide-core--extension)) |
| `homepage` | `''` | an http(s) address; left out of `hello` when empty |
| `description` | `''` | at most 200 characters; left out when empty |
| `stateDir` | `~/.config/infinity-core-api/<id>/` | where the token and the key are kept (see [Saved state](#saved-state)) |

### Properties

| property | meaning |
|---|---|
| `ext.info` | the `hello` parameters (without the token) |
| `ext.stateDir` | the folder for the saved state |
| `ext.state` | the last state: starts as `'disconnected'`; see [States](#states) |
| `ext.grant` | the last grant, `{ scopes, actsAs }`, where `actsAs` is `{ profile, name }` or `'everyone'`; `{}` until enabled. It is not cleared on disconnect, Turn off or Remove. |
| `ext.core` | Infinity Core's details from the last answer: `{ id, name, version, api, preview, profiles? }` |

Other properties and methods on the object (`session`, `apply`, `read`, `incoming`, `load`, `save`, `ws`, `pending` …)
are the SDK's own and may change.

### Handlers

Handlers may be plain or `async` functions. The four registration methods return the extension, so they chain:
`ext.on(…).provide(…).onReady(…)`.

An error thrown in an event, `onReady` or `onState` handler is logged with `console.error` (`infinity-core-api:
handler failed: …`) and never ends `run()`; the other handlers still run. An error thrown in a `provide` handler
becomes the error answer (below).

#### `ext.on(event, fn)`

Calls `fn(params)` for each notification `event` from Infinity Core. Several handlers may share an event; they run in
the order they were added. Use it for the events in
[SPEC §6](../../spec/SPEC.md#6-events-core--extension-notifications) (subscribe to them with `subscribe()`), and for
`'extension.state'`, which reaches your handler after the SDK has handled it.

#### `ext.provide(method, fn)`

Answers a call from Infinity Core. One handler per method; a second one replaces the first. `fn(params)` gets the
call's `params` (`{}` when there are none) and returns, or resolves to, the result:

- a JSON value: it is the answer;
- `null` or `undefined`: the answer is `null`, which means "nothing" and is not an error;
- throw an `RpcError`: the answer is an error with its `code` and its `rpcMessage`;
- throw anything else: the answer is error `-32603` with the error's `message`.

The message sent is cut to 200 characters. A call to a method with no handler is
answered `-32601` ("not provided: <method>"). Infinity Core calls only the services in `provides`, so declare them
there too. Calls are handled as they come, so several may run at once.

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

#### `ext.onReady(fn)`

Calls `fn(grant)` each time the state becomes `'enabled'`: after `hello` on every connection (so after every
reconnect), and when the Owner enables the extension or allows more while it is connected. Subscriptions made with
`subscribe()` are already restored when it runs. Do your set-up here: subscribe, and send `status.set`, `actions.set`
and `volume_control.register` / `source_control.register`, which Infinity Core keeps only for the current
connection.

#### `ext.onState(fn)`

Calls `fn(state, result)` on every state change. `result` is the `hello` answer or the `extension.state` parameters,
so it may hold `token`, `grant`, `core`, `pending` and `reason`. It may carry the token: do not log it whole.

### States

| state | when | `result` | what the SDK does |
|---|---|---|---|
| `'waiting'` | the Owner has not enabled it yet | `{ state, core }` | stays connected; `extension.state` arrives when the Owner decides |
| `'enabled'` | you may work | `{ state, grant, core, token?, pending? }` | saves a new token, restores subscriptions, runs `onReady` |
| `'disabled'` | turned off by the Owner (or **Not now**) | `{ state, reason? }` | Infinity Core closes the socket; the SDK keeps the token and tries again after about 60 s, each time |
| `'removed'` | removed by the Owner | `{ state }` | deletes the saved token; reconnects without one, so the extension is waiting again |
| `'blocked'` | blocked for everyone | `{ state, reason }` | closes the socket; `run()` rejects with `Stopped` |
| `'upgrade'` | this Infinity Core is older than `api` 1 | `{ state }` | closes the socket; `run()` rejects with `Stopped` |
| `'disconnected'` | the connection dropped | `{}` | sent once per drop; `run()` reconnects by itself |

`'disconnected'` is not sent when a connection attempt fails while the state is already `'disconnected'`, so it
comes once, not on every retry. `pending` lists what you asked for beyond the current grant; the old grant keeps
working until the Owner decides ([SPEC §3.2](../../spec/SPEC.md#32-the-answer)).

### Methods

#### `await ext.run({ host = '', port = 8931, pin = '', coreId = '' } = {})`

Connects and stays connected. The promise never resolves.

| field | meaning |
|---|---|
| `host` | Infinity Core's address. Empty: `discover()` is run, and the first Infinity Core found is used from then on. |
| `port` | the port; 8931 unless Infinity Core announces another |
| `pin` | the key pin to require (DNS-SD `pin`). Empty: the saved pin, or else the first key seen is kept. |
| `coreId` | Infinity Core's id. It names the saved-state file; empty means `<host>_<port>`. Discovery fills it in. |

It retries a lost or refused connection only:

- a Node system error, one with a string `code` (`ECONNREFUSED`, `ECONNRESET`, `EHOSTUNREACH`, TLS errors …);
- `Error('disconnected')`: the socket closed;
- `Error('timeout')`: no TLS connection or no answer to `hello` in time;
- `Error('no Infinity Core found')`: discovery found none.

It waits about 1, 2, 4 … up to 60 s, plus up to 1 s at random. After a connection that ended without an error the
wait goes back to 1 s, except when it ended in `'disabled'` (Turn off or Not now): then it waits 60 s ("try again
later, quietly", [SPEC §3.2](../../spec/SPEC.md#32-the-answer)). Each new connection checks the key, sends `hello`
with the saved token, and handles the answer as in [States](#states).

Anything else ends `run()`, as in the Python SDK. The promise rejects with:

- `PinMismatch`: the key is not the expected one;
- `Stopped`: the answer was `'blocked'` or `'upgrade'`;
- `RpcError`: Infinity Core refused the `hello` itself, e.g. `-32602` for an `id` that is not reverse-DNS or an empty
  `name`;
- `Error('discovery needs the bonjour-service package; …')`: no `host` and no `bonjour-service`.

`Error('no WebSocket here: …')` — something answers at that address, but not as Infinity Core's WebSocket (for example
an Infinity Core without the API) — is retried, as in Python. When Infinity Core refuses the SDK's own
`events.subscribe` after a new `hello` (for example `-32003` once `read` is no longer granted), the SDK warns with
`console.warn` and carries on.

Errors in your handlers never end `run()`: they are logged.

#### `await ext.call(method, params, timeoutMs = 30000)`

Calls an Infinity Core method ([SPEC §5](../../spec/SPEC.md#5-methods-extension--core)) and resolves to its `result`.
`params` is left out when `undefined`.

It rejects with:

- `RpcError`: an error answer, e.g. `-32001` not enabled yet, `-32003` not allowed, `-32029` too many requests
  ([SPEC §9](../../spec/SPEC.md#9-errors));
- `Error('not connected')`: there is no connection now;
- `Error('disconnected')`: the link dropped before the answer. It rejects as soon as the socket closes, not after
  the timeout;
- `Error('timeout')`: no answer within `timeoutMs` milliseconds.

#### `ext.notify(method, params)`

Sends a notification: no answer comes back. It returns nothing (not a promise) and does nothing when there is no
connection. Use it for:

| method | params | SPEC |
|---|---|---|
| `status.set` | `{ message, error? }`: one line, at most 80 characters | [§7.9](../../spec/SPEC.md#79-status) |
| `actions.set` | `{ actions: [{ id, label, on: ['track', 'album', 'artist'] }] }` | [§7.6](../../spec/SPEC.md#76-actions) |
| `volume_control.register` | `{ id, name, value, min, max, step, unit, muted }` | [§7.7](../../spec/SPEC.md#77-volume_control) |
| `volume_control.update` | `{ id, value, muted }` | [§7.7](../../spec/SPEC.md#77-volume_control) |
| `source_control.register` | `{ id, name, standby }` | [§7.8](../../spec/SPEC.md#78-source_control) |

Infinity Core keeps these for the current connection only, so send them from `onReady`. It ignores `actions.set` and
the `*_control.*` ones until the extension is enabled with that service in `provides`.

#### `await ext.subscribe(events)`

Subscribes to events (`zone.changed`, `zone.removed`, `queue.changed`, `outputs.changed`, `library.changed`) and
resolves to the answer of `events.subscribe`: the current state of what you asked for
([SPEC §5.1](../../spec/SPEC.md#51-core)). For `zone.changed` it holds a `zones` list, for `outputs.changed` an
`outputs` list.

The SDK remembers every event you subscribe to and subscribes again, before `onReady`, each time the state becomes
`'enabled'`. That repeat's answer is not passed on, so read the current state from your own `subscribe()` call in
`onReady`.

Events are remembered only once Infinity Core accepted them: a `subscribe()` that fails (for example without `read`)
leaves nothing behind.

#### `await ext.unsubscribe(events)`

Stops events: it removes them from the remembered list, so a reconnect does not subscribe them again, and calls
`events.unsubscribe`. Resolves to its answer, `{}`.

## Errors

### `RpcError`

A JSON-RPC error: `new RpcError(code, message, data)`. `e.code` (number), `e.rpcMessage` (the message alone) and
`e.data` (anything, or `undefined`). `e.message` is `'<code>: <message>'`, for logs. `call()` rejects with it for an
error answer; throw `new RpcError(code, message)` in a `provide` handler to answer with an error, which sends `code`
and `rpcMessage`.

```js
import { RpcError } from 'infinity-core-api'

try {
  await ext.call('volume.set', { value: -20 })
} catch (e) {
  if (e instanceof RpcError && e.code === -32010) { /* not possible on this output, e.g. a fixed volume */ }
  else throw e
}
```

### `PinMismatch`

`run()` rejects with it when Infinity Core's key differs from the `pin` you gave, or from the one saved the first
time. The message is `'<host>: the Core\'s key changed. Remove the extension\'s saved state if this is expected.'`
Stop and tell the person ([SPEC §2.2](../../spec/SPEC.md#22-the-connection)). If they reinstalled Infinity Core or
moved it, delete that Core's file in `stateDir` and start again; the Owner then enables the extension again.

### `Stopped`

`run()` rejects with it when Infinity Core will not work with this extension. `e.state` is `'blocked'` or
`'upgrade'`; `e.reason` is Infinity Core's reason, or `''`. On `'upgrade'`, tell the person to update Infinity Core.

A `'blocked'` that arrives while connected closes the socket; the next `hello` answers `'blocked'`, which rejects.

## Saved state

The SDK keeps one JSON file per Infinity Core: `<stateDir>/<core key>.json`, holding `{ "pin": …, "token": … }`.

- `<core key>` is Infinity Core's id (from discovery, or `coreId`), or `<host>_<port>`.
- The pin is saved the first time the SDK sees a key, when no `pin` was given. The token is saved when Infinity Core
  sends one, and deleted on `'removed'`.
- The file is written to a `.tmp` file with mode `0600` first, then renamed. Reads and writes are synchronous.

Keep the file private: anyone with the token can act with the extension's grant. In Docker, put `stateDir` (or
`$HOME`) on a volume.

If the file cannot be written (for example a read-only folder), the error is a Node system error (`EACCES`,
`EROFS` …), which `run()` treats like a lost connection: it keeps trying, and warns with `console.warn` each time. Check the folder's
permissions when an extension never shows up in Settings › Extensions.

## Discovery

### `await discover(timeoutMs = 2000)`

Finds Infinity Cores on the network that speak this API, by DNS-SD `_infinity-core._tcp.local`
([SPEC §2.1](../../spec/SPEC.md#21-finding-infinity-core)). It listens for `timeoutMs` milliseconds and resolves to a
list of `{ name, host, port, id, pin }`. Cores whose TXT record has no `api=1` are left out. `host` is the first IPv4
address, else the host name. It needs `bonjour-service` and throws an `Error` without it.

```js
import { discover } from 'infinity-core-api'

const [core] = await discover()
if (core) await ext.run({ host: core.host, port: core.port, pin: core.pin, coreId: core.id })
```

### `pinOf(certDer)`

Returns the pin of a DER certificate (a `Buffer`): the base64 SHA-256 of its SubjectPublicKeyInfo, as in Infinity
Core's DNS-SD `pin`. The SDK uses it on every connection; you need it only to compare a key yourself.

## Connection details

- TLS with `rejectUnauthorized: false` (the certificate is self-signed), then the pin is checked. SNI is sent for a
  host name, not for an IP address.
- The SDK answers Infinity Core's WebSocket pings itself. Keep the event loop free: long synchronous work delays the
  answers.
- A message from Infinity Core bigger than 1 MB closes the connection, whether it comes in one frame or several
  ([SPEC §2.2](../../spec/SPEC.md#22-the-connection)). Keep your own messages under 1 MB too. No audio travels over
  this API.

## Differences from the Python SDK

| | Python | JavaScript |
|---|---|---|
| Construction | keyword arguments, `state_dir=` | one object, `stateDir` |
| Registering handlers | decorators: `@ext.on(event)`, `@ext.provide(method)`, `@ext.on_ready`, `@ext.on_state` | `ext.on(event, fn)`, `ext.provide(method, fn)`, `ext.onReady(fn)`, `ext.onState(fn)`; they return the extension |
| `run()` | `core_id=` | `coreId` |
| No discovery package | `RuntimeError` | `Error` |
| Error class | `Error`; `e.message` is the message alone | `RpcError`; `e.rpcMessage` is the message alone, `e.message` is `'<code>: <message>'` |
| A failed handler is logged | on the `infinity_core_api` logger | with `console.error` |
| `call()` timeout | `timeout` in seconds; raises `asyncio.TimeoutError` | `timeoutMs`; rejects with `Error('timeout')` |
| `notify()` | a coroutine | returns nothing |
| `discover()` | `timeout` in seconds; zeroconf; `RuntimeError` without it | `timeoutMs`; `bonjour-service`; `Error` without it; prefers an IPv4 address |
| Pin helper | `pin_of()` | `pinOf()` |
| Saved state file I/O | in a thread (`asyncio.to_thread`) | synchronous |

The same on both sides: handlers may be plain or `async`; a handler that throws is logged and never ends `run()`;
`run()` gives up on the same errors (`PinMismatch`, `Stopped`, a refused `hello`, no discovery package), apart from
the row above; a provider that throws the SDK's error class sends its code and the message alone. The wire protocol,
the saved-state file and the states are the same too.

## Licence

MIT.
