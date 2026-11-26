// Infinity Core API — JavaScript SDK for Node 18+ (draft, matches SPEC.md v1 draft 2026-11-25). MIT License.
// No dependencies: its own small WebSocket client on node:tls, the Core's key pinned (its DNS-SD `pin`, or the first one
// seen). Discovery uses the optional `bonjour-service` package when it is installed; otherwise give the Core's address.
//
//   import { Extension } from 'infinity-core-api'
//   const ext = new Extension({ id: 'org.example.now-playing', name: 'Now Playing', version: '1.0.0', publisher: 'example', uses: ['read'] })
//   ext.on('zone.changed', ({ zone }) => console.log(zone.nowPlaying?.track.title))
//   ext.onReady(() => ext.subscribe(['zone.changed']))
//   await ext.run({ host: 'living-room.local' })

import tls from 'node:tls'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const API = 1
export const DEFAULT_PORT = 8931
const PATH = '/ext/v1'
const MAX_MESSAGE = 1 << 20  // SPEC §2.2

// a lost or refused connection (run() retries it): a Node system error (ECONNREFUSED, TLS …), a closed socket, no answer
const transient = (e) => typeof e?.code === 'string' || ['disconnected', 'timeout', 'no Infinity Core found', 'no WebSocket here'].includes(e?.message)
// a routine drop says nothing; anything else retried (an unwritable stateDir, a bad host name…) is said
const routine = (e) => ['disconnected', 'timeout'].includes(e?.message) || ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE'].includes(e?.code)
// onState / onReady / event handlers: one that throws is logged, never ends run()
async function tell(fns, ...args) {
  for (const fn of fns) { try { await fn(...args) } catch (e) { console.error('infinity-core-api: handler failed:', e) } }
}

export class RpcError extends Error {
  constructor(code, message, data) { super(`${code}: ${message}`); this.code = code; this.rpcMessage = message; this.data = data }
}
export class PinMismatch extends Error {}
export class Stopped extends Error {
  constructor(state, reason = '') { super(reason ? `${state}: ${reason}` : state); this.state = state; this.reason = reason }
}

// the pin of a certificate: base64 SHA-256 of its SubjectPublicKeyInfo (Core's DNS-SD `pin`)
export function pinOf(certDer) {
  const spki = new crypto.X509Certificate(certDer).publicKey.export({ type: 'spki', format: 'der' })
  return crypto.createHash('sha256').update(spki).digest('base64')
}

// ── a small WebSocket client (RFC 6455): text frames, ping / pong, close ──────────────────────────────────────────────
class Socket {
  static connect(host, port, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      const s = tls.connect({ host, port, servername: /^[\d.:]+$/.test(host) ? undefined : host, rejectUnauthorized: false })  // self-signed: the pin is the check
      const timer = setTimeout(() => { s.destroy(); reject(new Error('timeout')) }, timeoutMs)
      s.once('error', (e) => { clearTimeout(timer); reject(e) })
      s.once('secureConnect', () => {
        const key = crypto.randomBytes(16).toString('base64')
        s.write(`GET ${PATH} HTTP/1.1\r\nHost: ${host}:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`)
        let head = Buffer.alloc(0)
        const onData = (d) => {
          head = Buffer.concat([head, d])
          const end = head.indexOf('\r\n\r\n')
          if (end < 0) return
          s.off('data', onData)
          clearTimeout(timer)
          const lines = head.subarray(0, end).toString('latin1').split('\r\n')
          const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64')
          const hdr = Object.fromEntries(lines.slice(1).map((l) => [l.split(':')[0].trim().toLowerCase(), l.slice(l.indexOf(':') + 1).trim()]))
          if (!/ 101 /.test(lines[0] + ' ') || hdr['sec-websocket-accept'] !== accept) { s.destroy(); return reject(new Error(`no WebSocket here: ${lines[0]}`)) }
          resolve(new Socket(s, head.subarray(end + 4)))
        }
        s.on('data', onData)
      })
    })
  }
  constructor(s, rest) {
    this.s = s; this.buf = rest; this.parts = []; this.onText = () => {}; this.onClose = () => {}
    s.on('data', (d) => { this.buf = Buffer.concat([this.buf, d]); this.parse() })
    s.on('close', () => this.onClose())
    s.on('error', () => {})
    if (rest.length) setImmediate(() => this.parse())
  }
  peerCert() { return this.s.getPeerCertificate(true).raw }
  frame(op, data) {
    const n = data.length, mask = crypto.randomBytes(4)
    const head = n < 126 ? Buffer.from([0x80 | op, 0x80 | n]) : n < 65536 ? Buffer.from([0x80 | op, 0x80 | 126, n >> 8, n & 255])
      : Buffer.concat([Buffer.from([0x80 | op, 0x80 | 127]), (() => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(n)); return b })()])
    const body = Buffer.from(data)
    for (let i = 0; i < n; i++) body[i] ^= mask[i & 3]
    this.s.write(Buffer.concat([head, mask, body]))
  }
  send(text) { this.frame(0x1, Buffer.from(text)) }
  close() { try { this.frame(0x8, Buffer.from([0x03, 0xe8])) } catch {} this.s.end() }
  parse() {
    for (;;) {
      if (this.buf.length < 2) return
      const b0 = this.buf[0], b1 = this.buf[1]
      let n = b1 & 0x7f, at = 2
      if (n === 126) { if (this.buf.length < 4) return; n = this.buf.readUInt16BE(2); at = 4 }
      else if (n === 127) { if (this.buf.length < 10) return; n = Number(this.buf.readBigUInt64BE(2)); at = 10 }
      if (n > MAX_MESSAGE) { this.close(); return }
      const masked = b1 & 0x80
      const need = at + (masked ? 4 : 0) + n
      if (this.buf.length < need) return
      let data = this.buf.subarray(at + (masked ? 4 : 0), need)
      if (masked) { const m = this.buf.subarray(at, at + 4); data = Buffer.from(data.map((c, i) => c ^ m[i & 3])) }
      this.buf = this.buf.subarray(need)
      const op = b0 & 0x0f
      if (op === 0x9) this.frame(0xa, data)
      else if (op === 0x8) { this.close(); return }
      else if (op === 0x1 || op === 0x0) {
        this.parts.push(data)
        if (this.parts.reduce((t, x) => t + x.length, 0) > MAX_MESSAGE) { this.close(); return }  // the whole message, not each frame
        if (b0 & 0x80) { const t = Buffer.concat(this.parts).toString(); this.parts = []; this.onText(t) }
      }
    }
  }
}

// Infinity Cores on the network that speak this API: [{name, host, port, id, pin}]. Needs `npm i bonjour-service`.
export async function discover(timeoutMs = 2000) {
  let Bonjour
  try { ({ Bonjour } = await import('bonjour-service')) } catch { throw new Error('discovery needs the bonjour-service package; or give the Core\'s address') }
  const b = new Bonjour(), found = []
  const browser = b.find({ type: 'infinity-core' }, (svc) => {
    const txt = svc.txt ?? {}
    if (String(txt.api) === String(API)) found.push({ name: svc.name, host: svc.addresses?.find((a) => a.includes('.')) ?? svc.host, port: svc.port, id: txt.id ?? '', pin: txt.pin ?? '' })
  })
  await new Promise((r) => setTimeout(r, timeoutMs))
  browser.stop(); b.destroy()
  return found
}

// ── the extension ──────────────────────────────────────────────────────────────────────────────────────────────────────
export class Extension {
  constructor({ id, name, version, publisher, uses = [], provides = [], homepage = '', description = '', stateDir = '' }) {
    this.info = { api: API, id, name, version, publisher, uses, provides, ...(homepage ? { homepage } : {}), ...(description ? { description } : {}) }
    this.stateDir = stateDir || path.join(os.homedir(), '.config', 'infinity-core-api', id)
    this.events = new Map(); this.provided = new Map(); this.readyCbs = []; this.stateCbs = []
    this.ws = null; this.pending = new Map(); this.next = 0; this.subs = new Set(); this.coreKey = ''
    this.state = 'disconnected'; this.grant = {}; this.core = {}
  }
  on(event, fn) { (this.events.get(event) ?? this.events.set(event, []).get(event)).push(fn); return this }
  provide(method, fn) { this.provided.set(method, fn); return this }  // answer a call from the Core; return null for "nothing"
  onReady(fn) { this.readyCbs.push(fn); return this }                 // each time it is enabled (after every reconnect too)
  onState(fn) { this.stateCbs.push(fn); return this }                 // (state, result) on every change

  call(method, params, timeoutMs = 30000) {
    if (!this.ws) return Promise.reject(new Error('not connected'))
    const id = ++this.next
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.pending.delete(id); reject(new Error('timeout')) }, timeoutMs)
      this.pending.set(id, { resolve: (v) => { clearTimeout(t); resolve(v) }, reject: (e) => { clearTimeout(t); reject(e) } })
      this.ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, ...(params !== undefined ? { params } : {}) }))
    })
  }
  notify(method, params) { this.ws?.send(JSON.stringify({ jsonrpc: '2.0', method, ...(params !== undefined ? { params } : {}) })) }
  // kept across reconnects; remembered only once the Core accepted it
  async subscribe(events) { const r = await this.call('events.subscribe', { events }); events.forEach((e) => this.subs.add(e)); return r }
  unsubscribe(events) { events.forEach((e) => this.subs.delete(e)); return this.call('events.unsubscribe', { events }) }

  load() { try { return JSON.parse(fs.readFileSync(path.join(this.stateDir, `${this.coreKey}.json`), 'utf8')) } catch { return {} } }
  save(d) {
    fs.mkdirSync(this.stateDir, { recursive: true })
    const p = path.join(this.stateDir, `${this.coreKey}.json`)
    fs.writeFileSync(p + '.tmp', JSON.stringify(d), { mode: 0o600 })
    fs.renameSync(p + '.tmp', p)
  }

  // connect and keep connected; without `host` the first Core found by discovery
  async run({ host = '', port = DEFAULT_PORT, pin = '', coreId = '' } = {}) {
    let delay = 1000
    for (;;) {
      try {
        if (!host) {
          const c = (await discover())[0]
          if (!c) throw new Error('no Infinity Core found')
          ;({ host, port, pin } = c); coreId = c.id
        }
        await this.session(host, port, pin, coreId || `${host}_${port}`)
        delay = this.state === 'disabled' ? 60000 : 1000  // turned off (or Not now): try again later, quietly (SPEC §3.2)
      } catch (e) {
        // as the Python SDK: only a lost or refused connection is retried; a refused hello, a missing bonjour-service… end run()
        if (e instanceof PinMismatch || e instanceof Stopped || !transient(e)) throw e
        if (!routine(e)) console.warn(`infinity-core-api: connecting to ${host || 'Infinity Core'}: ${e.message} — trying again`)
      }
      this.ws = null
      if (this.state !== 'disconnected') {  // tell onState once, so a UI can show the Core as gone (as the Python SDK)
        this.state = 'disconnected'
        await tell(this.stateCbs, 'disconnected', {})
      }
      await new Promise((r) => setTimeout(r, delay + Math.random() * 1000))
      delay = Math.min(delay * 2, 60000)
    }
  }

  async session(host, port, pin, coreKey) {
    const ws = await Socket.connect(host, port)
    this.coreKey = coreKey
    const saved = this.load()
    const seen = pinOf(ws.peerCert())
    const trusted = pin || saved.pin
    if (trusted && seen !== trusted) { ws.close(); throw new PinMismatch(`${host}: the Core's key changed. Remove the extension's saved state if this is expected.`) }
    if (!trusted) this.save({ ...saved, pin: seen })
    this.ws = ws
    const closed = new Promise((resolve) => {
      ws.onClose = () => {  // what waits for an answer gets none at once (hello too — not after 30 s)
        for (const [, p] of this.pending) p.reject(new Error('disconnected'))
        this.pending.clear()
        resolve()
      }
    })
    ws.onText = (t) => this.read(t)
    try {
      const res = await this.call('hello', { ...this.info, ...(saved.token ? { token: saved.token } : {}) })
      await this.apply(res)
      await closed
    } finally {
      ws.close()  // also when the run stops on an error: never leave the socket open
      this.ws = null
      for (const [, p] of this.pending) p.reject(new Error('disconnected'))
      this.pending.clear()
    }
  }

  async apply(res) {
    const saved = this.load()
    if (res.token) this.save({ ...saved, token: res.token })
    if (res.state === 'removed') { delete saved.token; this.save(saved) }
    if (res.core) this.core = res.core
    if (res.grant) this.grant = res.grant
    this.state = res.state
    await tell(this.stateCbs, res.state, res)
    if (res.state === 'blocked' || res.state === 'upgrade') { this.ws?.close(); throw new Stopped(res.state, res.reason ?? '') }
    if (res.state === 'enabled') {
      if (this.subs.size) {  // e.g. -32003 once the Owner unticked `read`: logged, the extension carries on
        try { await this.call('events.subscribe', { events: [...this.subs] }) }
        catch (e) { if (!(e instanceof RpcError)) throw e; console.warn('infinity-core-api: subscribing again refused:', e.message) }
      }
      await tell(this.readyCbs, this.grant)
    }
  }

  read(text) {
    let m
    try { m = JSON.parse(text) } catch { return }
    if (m.method) return void this.incoming(m)
    const p = this.pending.get(m.id)
    if (!p) return
    this.pending.delete(m.id)
    if (m.error) p.reject(new RpcError(m.error.code, m.error.message, m.error.data))
    else p.resolve(m.result)
  }

  async incoming(m) {
    const { method, id } = m, params = m.params ?? {}
    if (id === undefined || id === null) {  // a notification: state change or an event
      if (method === 'extension.state') { try { await this.apply(params) } catch { /* blocked while connected: run() sees the close */ } }
      await tell(this.events.get(method) ?? [], params)
      return
    }
    const fn = this.provided.get(method)
    let reply
    if (!fn) reply = { jsonrpc: '2.0', id, error: { code: -32601, message: `not provided: ${method}` } }
    else {
      try { reply = { jsonrpc: '2.0', id, result: (await fn(params)) ?? null } }
      catch (e) { reply = { jsonrpc: '2.0', id, error: { code: e instanceof RpcError ? e.code : -32603, message: String(e instanceof RpcError ? e.rpcMessage : e.message ?? e).slice(0, 200) } } }
    }
    this.ws?.send(JSON.stringify(reply))
  }
}
