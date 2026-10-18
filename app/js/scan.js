// Netz-Scan in zwei Durchgängen:
//   1. Discovery: wenige Ports über alle Adressen → lebende Hosts
//   2. Port-Pass: gewähltes Profil nur auf den gefundenen Hosts
import { Pool } from './pool.js';
import { calibrate, probe } from './probe.js';
import { hostsOf, parseCidr } from './netdetect.js';
import { PROFILES } from './ports.js';
import { fingerprint } from './fingerprint.js';

export const DISCOVERY_PORTS = [80, 443, 8080];

const LIVE = new Set(['open-http', 'open', 'closed', 'alive']);
export const OPEN = new Set(['open-http', 'open']);

export class NetScan extends EventTarget {
  constructor(cidr, { gateway, ports = PROFILES.schnell.ports, profile = 'schnell', limit = 96 } = {}) {
    super();
    this.net = parseCidr(cidr);
    this.cidr = this.net.cidr;
    this.gateway = gateway || this.net.hostIp(1);
    this.ports = ports;
    this.profile = profile;
    this.pool = new Pool({ limit, perHost: 6 });
    this.devices = new Map();
    this.cal = null;
    this.progress = { phase: 'calibrate', done: 0, total: 0 };
    this.startedAt = Date.now();
  }

  stop() { this.pool.abort(); }
  get aborted() { return this.pool.aborted; }

  #emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }

  #setPhase(phase, total) {
    this.progress = { phase, done: 0, total };
    this.#emit('progress', this.progress);
  }

  #tick() {
    this.progress.done++;
    this.#emit('progress', this.progress);
  }

  #record(ip, r) {
    if (!r || !LIVE.has(r.state)) return;
    let d = this.devices.get(ip);
    const isNew = !d;
    if (!d) {
      d = { ip, net: this.cidr, ports: {}, firstSeen: Date.now(), lastSeen: Date.now(), isGatewayGuess: ip === this.gateway };
      this.devices.set(ip, d);
    }
    d.lastSeen = Date.now();
    const prev = d.ports[r.port];
    // Ein sicheres Ergebnis nicht durch ein unsichereres ersetzen
    if (!prev || rank(r.state) >= rank(prev.state)) d.ports[r.port] = r;
    this.#emit(isNew ? 'device' : 'update', d);
  }

  async run() {
    const signal = this.pool.signal;
    this.#setPhase('calibrate', 1);
    this.cal = await calibrate(this.gateway, signal);
    this.#emit('calibrated', this.cal);
    if (this.aborted) return this.#finish();

    const hosts = hostsOf(this.cidr);
    this.#setPhase('discovery', hosts.length * DISCOVERY_PORTS.length);
    await Promise.all(hosts.flatMap((ip) => DISCOVERY_PORTS.map((port) =>
      this.pool.run(ip, (s) => probe(ip, port, this.cal, s)).then((r) => { this.#record(ip, r); this.#tick(); }))));
    if (this.aborted) return this.#finish();

    const alive = [...this.devices.keys()];
    const rest = this.ports.filter((p) => !DISCOVERY_PORTS.includes(p));
    this.#setPhase('ports', alive.length * rest.length);
    await Promise.all(alive.flatMap((ip) => rest.map((port) =>
      this.pool.run(ip, (s) => probe(ip, port, this.cal, s)).then((r) => { this.#record(ip, r); this.#tick(); }))));
    if (this.aborted) return this.#finish();

    this.#setPhase('fingerprint', alive.length);
    await Promise.all(alive.map((ip) => this.pool.run(ip, (s) => fingerprint(this.devices.get(ip), { signal: s }))
      .then((r) => { this.#applyFingerprint(ip, r); this.#tick(); })));
    return this.#finish();
  }

  #applyFingerprint(ip, r) {
    if (!r) return;
    const d = this.devices.get(ip);
    for (const [port, svc] of Object.entries(r.services)) if (d.ports[port]) d.ports[port].service = svc;
    if (r.device) {
      const { mac, ...rest } = r.device;
      Object.assign(d, rest);
      if (mac) { d.mac = mac; d.macSource = 'device-api'; }
    }
    this.#emit('update', d);
  }

  #finish() {
    this.progress = { ...this.progress, phase: this.aborted ? 'aborted' : 'done' };
    this.finishedAt = Date.now();
    this.#emit('done', { aborted: this.aborted, devices: this.devices });
    return this.devices;
  }
}

function rank(state) {
  return { 'open-http': 4, open: 3, alive: 2, closed: 1 }[state] || 0;
}

export function openPorts(d) {
  return Object.values(d.ports).filter((p) => OPEN.has(p.state)).sort((a, b) => a.port - b.port);
}
