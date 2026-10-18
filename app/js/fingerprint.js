// Geräteerkennung ohne lesbare HTTP-Antworten (CORS):
//   - WebSocket-RPC (Shelly Gen2+) – WebSockets unterliegen nicht CORS
//   - EventSource (ESPHome sendet CORS-Header)
//   - CORS-JSON-APIs (WLED, Tasmota – sofern das Gerät CORS erlaubt)
//   - Bildpfade per <img> (laden ohne CORS, nur Erfolg und Maße sichtbar)
//   - Port-Regeln (z. B. TR-064 → FRITZ!)
// Messungen: docs/M3-fingerprints.md
import { webUrl } from './ports.js';

const SIG = await fetch(new URL('../data/signatures.json', import.meta.url)).then((r) => r.json());

const LNA = location.protocol === 'https:' ? { targetAddressSpace: 'local' } : {};

function withTimeout(signal, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  const onOuter = () => ctrl.abort();
  signal?.addEventListener('abort', onOuter, { once: true });
  const done = () => { clearTimeout(timer); signal?.removeEventListener('abort', onOuter); };
  return { signal: ctrl.signal, done };
}

export function loadImage(url, timeout = 3000, signal) {
  return new Promise((resolve) => {
    const img = new Image();
    img.referrerPolicy = 'no-referrer';
    const t = withTimeout(signal, timeout);
    const finish = (ok) => {
      t.done();
      img.onload = img.onerror = null;
      if (!ok) img.src = '';
      resolve(ok && img.naturalWidth ? { w: img.naturalWidth, h: img.naturalHeight } : null);
    };
    t.signal.addEventListener('abort', () => finish(false), { once: true });
    img.onload = () => finish(true);
    img.onerror = () => finish(false);
    img.src = url;
  });
}

function wsRpc(host, method, timeout = 2500, signal) {
  return new Promise((resolve) => {
    let ws;
    try { ws = new WebSocket(`ws://${host}/rpc`); } catch { resolve(null); return; }
    const t = withTimeout(signal, timeout);
    const finish = (v) => { t.done(); try { ws.close(); } catch {} resolve(v); };
    t.signal.addEventListener('abort', () => finish(null), { once: true });
    ws.onopen = () => ws.send(JSON.stringify({ id: 1, src: 'netzscan', method }));
    ws.onmessage = (e) => {
      try { finish(JSON.parse(e.data).result || null); } catch { finish(null); }
    };
    ws.onerror = () => finish(null);
  });
}

function esphomePing(host, timeout = 2500, signal) {
  return new Promise((resolve) => {
    let es;
    try { es = new EventSource(`http://${host}/events`); } catch { resolve(null); return; }
    const t = withTimeout(signal, timeout);
    const finish = (v) => { t.done(); es.close(); resolve(v); };
    t.signal.addEventListener('abort', () => finish(null), { once: true });
    es.addEventListener('ping', (e) => {
      try { finish(JSON.parse(e.data)); } catch { finish(null); }
    });
    es.onerror = () => finish(null);
  });
}

async function corsJson(url, timeout = 2500, signal) {
  const t = withTimeout(signal, timeout);
  try {
    const r = await fetch(url, { mode: 'cors', cache: 'no-store', credentials: 'omit', signal: t.signal, ...LNA });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  } finally {
    t.done();
  }
}

const spaced = (s) => String(s || '').replace(/([a-z])([A-Z0-9])/g, '$1 $2');

// --- Geräte-APIs (nur auf Port 80) -----------------------------------------
const APIS = [
  async (host, signal) => {
    const r = await wsRpc(host, 'Shelly.GetDeviceInfo', 2500, signal);
    if (!r?.mac) return null;
    return {
      name: r.name || `Shelly ${spaced(r.app || r.model)}`, vendor: 'Shelly', model: r.model,
      type: 'switch', category: 'smarthome', mac: r.mac, fw: r.ver, via: 'Shelly-RPC (WebSocket)',
    };
  },
  async (host, signal) => {
    const r = await esphomePing(host, 2500, signal);
    if (!r?.title) return null;
    return { name: r.title, vendor: 'ESPHome', type: 'sensor', category: 'smarthome', via: 'ESPHome-Ereignisse' };
  },
  async (host, signal) => {
    const r = await corsJson(`http://${host}/json/info`, 2500, signal);
    if (!r?.brand && !r?.ver) return null;
    return { name: r.name || 'WLED', vendor: r.brand || 'WLED', model: r.arch, type: 'light', category: 'smarthome', mac: r.mac, fw: r.ver, via: 'WLED-API' };
  },
  async (host, signal) => {
    const r = await corsJson(`http://${host}/cm?cmnd=Status%200`, 2500, signal);
    if (!r?.Status) return null;
    return {
      name: r.Status.DeviceName || r.Status.FriendlyName?.[0] || 'Tasmota', vendor: 'Tasmota', type: 'switch',
      category: 'smarthome', mac: r.StatusNET?.Mac, fw: r.StatusFWR?.Version, via: 'Tasmota-API',
    };
  },
];

const normMac = (m) => {
  const hex = String(m || '').replace(/[^0-9a-f]/gi, '');
  return hex.length === 12 ? hex.match(/../g).join(':').toUpperCase() : null;
};

// Ergebnis: { device: {...Felder}, services: { port: name } } oder null
export async function fingerprint(d, { signal } = {}) {
  const open = Object.values(d.ports).filter((p) => p.state === 'open-http' || (p.state === 'open' && p.scheme === 'https'));
  const openSet = new Set(Object.values(d.ports).filter((p) => p.state === 'open-http' || p.state === 'open').map((p) => p.port));
  let device = null;
  const services = {};

  // 1. Geräte-APIs auf Port 80
  if (d.ports[80]?.state === 'open-http') {
    for (const api of APIS) {
      if (signal?.aborted) return null;
      const r = await api(d.ip, signal);
      if (r) {
        device = { ...r, mac: normMac(r.mac), nameSource: 'device-api' };
        services[80] = { name: r.name, category: r.category };
        break;
      }
    }
  }

  // 2. Bildpfade auf passenden offenen Ports
  for (const sig of SIG.images) {
    for (const p of open) {
      if (!sig.ports.includes(p.port) || services[p.port] || signal?.aborted) continue;
      const base = webUrl(d.ip, p.port).url;
      const img = await loadImage(new URL(sig.path, base).href, 3000, signal);
      if (!img || (sig.size && sig.size !== `${img.w}x${img.h}`)) continue;
      services[p.port] = { name: sig.name, category: sig.category };
      if (!device || (sig.type === 'server' && device.nameSource !== 'device-api')) {
        device = { name: sig.name, type: sig.type, category: sig.category, nameSource: 'signature', via: `Bild ${sig.path}` };
      }
    }
  }

  // 3. Port-Regeln
  for (const rule of SIG.portRules) {
    if (!rule.ports.every((p) => openSet.has(p))) continue;
    const name = d.isGatewayGuess ? rule.name : rule.nameNotGateway || rule.name;
    if (!device || device.nameSource === 'signature') {
      device = { name, type: rule.type, category: rule.category, vendor: rule.vendor, nameSource: 'port-rule', via: rule.note };
    }
  }

  // Mehrere erkannte Dienste ohne Geräte-Treffer: zusammenfassen
  const names = [...new Set(Object.values(services).map((s) => s.name))];
  if (device?.nameSource === 'signature' && names.length > 1) device.name = names.slice(0, 3).join(' · ');

  return device || names.length ? { device, services } : null;
}
