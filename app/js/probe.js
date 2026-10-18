// Port-Probes über fetch()-Timing. Messwerte und Begründung: docs/M0-spike.md
//
// Ergebnis (state):
//   open-http  Antwort erhalten → HTTP-Dienst                       (sicher)
//   open       schneller Fehler bei Windows-Timing → offen, aber
//              kein HTTP bzw. TLS-Fehler (selbstsigniert)            (wahrscheinlich)
//   closed     Fehler nach RST-Zeit → Host lebt, Port zu
//   alive      Fehler, bei sofortigem RST nicht unterscheidbar ob
//              zu oder offen ohne HTTP → Host lebt                   (unklar)
//   timeout    kein Host oder gefiltert
//   blocked    vom Browser gesperrter Port, nie gesendet

import { BAD_PORTS, webUrl } from './ports.js';

const PRIVATE = [
  ['10.0.0.0', 8], ['172.16.0.0', 12], ['192.168.0.0', 16], ['169.254.0.0', 16],
];

export const ipToInt = (ip) => ip.split('.').reduce((a, b) => (a << 8) + Number(b), 0) >>> 0;
export const intToIp = (n) => [24, 16, 8, 0].map((s) => (n >>> s) & 255).join('.');

export function isPrivateIp(ip) {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip) || ip.split('.').some((o) => Number(o) > 255)) return false;
  const n = ipToInt(ip);
  return PRIVATE.some(([base, bits]) => (n >>> (32 - bits)) === (ipToInt(base) >>> (32 - bits)));
}

const IS_WINDOWS = /Windows/i.test(navigator.userAgent);

// Ohne Messung: Windows ≈ 2 s RST-Verzögerung, sonst sofort
export function defaultCalibration() {
  return IS_WINDOWS
    ? { rstMs: 2000, slowRst: true, timeout: 2700, measured: false }
    : { rstMs: 30, slowRst: false, timeout: 1500, measured: false };
}

// Mixed Content: aus einer HTTPS-Seite heraus braucht Chrome den Hinweis auf
// das lokale Netz (Local Network Access), sonst wird http:// blockiert
const LNA = location.protocol === 'https:' ? { targetAddressSpace: 'local' } : {};

// Ein roher Versuch: { ok, ms, aborted }
export async function rawProbe(url, timeout, outerSignal) {
  const ctrl = new AbortController();
  const onOuter = () => ctrl.abort();
  outerSignal?.addEventListener('abort', onOuter, { once: true });
  const timer = setTimeout(() => ctrl.abort(), timeout);
  const t0 = performance.now();
  try {
    await fetch(url, { mode: 'no-cors', cache: 'no-store', credentials: 'omit', signal: ctrl.signal, ...LNA });
    return { ok: true, ms: performance.now() - t0, aborted: false };
  } catch {
    return { ok: false, ms: performance.now() - t0, aborted: ctrl.signal.aborted };
  } finally {
    clearTimeout(timer);
    outerSignal?.removeEventListener('abort', onOuter);
  }
}

export function classify(r, cal) {
  if (r.ok) return 'open-http';
  if (r.aborted) return 'timeout';
  if (cal.slowRst) return r.ms < cal.rstMs * 0.5 ? 'open' : 'closed';
  return 'alive';
}

export async function probe(ip, port, cal, signal) {
  if (!isPrivateIp(ip)) throw new Error(`${ip} ist keine private Adresse`);
  const { scheme, url } = webUrl(ip, port);
  if (BAD_PORTS.has(port)) return { port, scheme, state: 'blocked', ms: 0 };
  const r = await rawProbe(url, cal.timeout, signal);
  return { port, scheme, state: classify(r, cal), ms: Math.round(r.ms) };
}

// RST-Zeit an zwei selten offenen Ports des Gateways messen
export async function calibrate(gatewayIp, signal) {
  const base = defaultCalibration();
  const runs = await Promise.all([2, 4].map((p) => rawProbe(`http://${gatewayIp}:${p}/`, 4000, signal)));
  const rst = runs.filter((r) => !r.ok && !r.aborted).map((r) => r.ms);
  if (!rst.length) return base; // Gateway verwirft statt RST – Standardwerte
  const rstMs = Math.max(...rst);
  const slowRst = rstMs > 500;
  return {
    rstMs: Math.round(rstMs),
    slowRst,
    timeout: slowRst ? Math.round(rstMs + 700) : 1500,
    measured: true,
  };
}
