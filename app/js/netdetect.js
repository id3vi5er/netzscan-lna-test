// Netz-Erkennung: Der Browser kennt die eigenen Schnittstellen nicht, also werden
// typische Gateway-Adressen angefragt. Antwortet dort irgendetwas, ist das Netz
// „wahrscheinlich verbunden".
import { Pool } from './pool.js';
import { defaultCalibration, probe, ipToInt, intToIp, isPrivateIp } from './probe.js';

export const CANDIDATE_NETS = [
  '192.168.178', '192.168.188', '192.168.179', // Fritz!Box (+ Gastnetz, Mesh)
  '192.168.0', '192.168.1', '192.168.2', '192.168.3', '192.168.4', '192.168.5',
  '192.168.8', '192.168.10', '192.168.11', '192.168.15', '192.168.20', '192.168.31',
  '192.168.50', '192.168.68', '192.168.86', '192.168.88', '192.168.100', '192.168.101',
  '192.168.123', '192.168.137', '192.168.168', '192.168.180', '192.168.199',
  '10.0.0', '10.0.1', '10.1.1', '10.10.10', '10.0.2', '172.16.0', '172.16.1',
].map((p) => `${p}.0/24`);

const GATEWAY_HOSTS = [1, 254];
const GATEWAY_PORTS = [80, 443];

// "192.168.178.0/24" → { base, bits, first, last, size }
export function parseCidr(cidr) {
  const m = String(cidr).trim().match(/^(\d{1,3}(?:\.\d{1,3}){3})(?:\/(\d{1,2}))?$/);
  if (!m) throw new Error('Format: 192.168.178.0/24');
  const bits = m[2] ? Number(m[2]) : 24;
  if (bits < 22 || bits > 30) throw new Error('Netzgröße /22 bis /30');
  if (!isPrivateIp(m[1])) throw new Error('Nur private Netze (10.x, 172.16–31.x, 192.168.x, 169.254.x)');
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  const net = (ipToInt(m[1]) & mask) >>> 0; // & liefert int32, für 192.168.x negativ
  const bcast = (net | (~mask >>> 0)) >>> 0;
  return {
    cidr: `${intToIp(net)}/${bits}`, bits, net, bcast,
    first: net + 1, last: bcast - 1, size: bcast - net - 1,
    hostIp: (i) => intToIp(net + i),
  };
}

export function hostsOf(cidr) {
  const n = parseCidr(cidr);
  const out = [];
  for (let i = n.first; i <= n.last; i++) out.push(intToIp(i));
  return out;
}

// onUpdate(result) wird pro Netz aufgerufen, sobald ein Gateway-Kandidat antwortet
export async function detectNetworks(nets, { onUpdate, onProgress, pool } = {}) {
  pool ??= new Pool({ limit: 96, perHost: 2 });
  const cal = defaultCalibration();
  const results = new Map(nets.map((cidr) => [cidr, { cidr, status: 'unknown', candidates: [] }]));
  const jobs = [];
  let done = 0;
  for (const cidr of nets) {
    const n = parseCidr(cidr);
    for (const h of GATEWAY_HOSTS) {
      const ip = h === 254 ? intToIp(n.bcast - 1) : intToIp(n.net + h);
      for (const port of GATEWAY_PORTS) {
        jobs.push(pool.run(ip, (signal) => probe(ip, port, cal, signal)).then((r) => {
          done++;
          onProgress?.(done, jobs.length);
          if (!r || r.state === 'timeout') return;
          const res = results.get(cidr);
          let c = res.candidates.find((x) => x.ip === ip);
          if (!c) res.candidates.push(c = { ip, ports: [] });
          c.ports.push(r);
          res.status = 'connected';
          res.gateway = pickGateway(res.candidates);
          onUpdate?.(res);
        }));
      }
    }
  }
  await Promise.all(jobs);
  for (const res of results.values()) if (res.status === 'unknown') res.status = 'none';
  return [...results.values()];
}

// .1 bevorzugt, Weboberfläche zählt mehr als nur „lebt"
function pickGateway(cands) {
  const score = (c) => (c.ip.endsWith('.1') ? 2 : 0) + (c.ports.some((p) => p.state === 'open-http' || p.state === 'open') ? 3 : 0);
  return [...cands].sort((a, b) => score(b) - score(a))[0]?.ip;
}
