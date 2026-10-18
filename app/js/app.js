import { showToast } from './copy.js';
import { CANDIDATE_NETS, detectNetworks, parseCidr } from './netdetect.js';
import { NetScan } from './scan.js';
import * as store from './store.js';
import { renderNetze } from './views/netze.js';
import { renderUebersicht } from './views/uebersicht.js';
import { initGeraete, renderGeraete } from './views/geraete.js';
import { renderDienste, services } from './views/dienste.js';
import { renderWeb } from './views/web.js';
import { PROFILES, parsePortList } from './ports.js';
import { ensureLocalAccess } from './lna.js';

const $ = (id) => document.getElementById(id);

const state = {
  tab: 'netze',
  nets: new Map(),          // cidr → Erkennungsergebnis
  customNets: store.customNets(),
  scans: store.allScans(),  // cidr → letzter gespeicherter Scan
  detect: { running: false, done: 0, total: 0 },
  activeCidr: null,
  devices: new Map(),
  gateway: null,
  cal: null,
  lastAt: null,
  scan: null,
  scanning: false,
  settings: store.settings(),
  get scanningCidr() { return this.scanning ? this.scan?.cidr : null; },
  get selectedPorts() {
    const { profile, customPorts } = this.settings;
    if (profile === 'eigene') return parsePortList(customPorts).ports || [];
    return (PROFILES[profile] || PROFILES.schnell).ports;
  },
};

// --- Rendern -----------------------------------------------------------------
let frame = 0;
function render() {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    $('devCount').textContent = state.devices.size;
    const svc = services(state.devices);
    $('svcCount').textContent = svc.length;
    $('webCount').textContent = svc.filter((x) => x.web).length;
    $('current').innerHTML = state.activeCidr ? `<span class="muted">Netz</span> <span class="mono">${state.activeCidr}</span>` : '';
    // Eingabefelder überleben das Neuzeichnen (Wert, Fokus, Cursor)
    const active = document.activeElement;
    const keep = active?.id && active.matches('.tab input') && !active.closest('#tab-geraete')
      ? { id: active.id, value: active.value, start: active.selectionStart, end: active.selectionEnd } : null;
    const tabs = {
      netze: () => renderNetze($('tab-netze'), state),
      uebersicht: () => renderUebersicht($('tab-uebersicht'), state),
      dienste: () => renderDienste($('tab-dienste'), state),
      web: () => renderWeb($('tab-web'), state),
      geraete: () => renderGeraete($('devBody'), $('devEmpty'), state.devices, $('search').value),
    };
    tabs[state.tab]();
    const el = keep && $(keep.id);
    if (el && el !== active) {
      el.value = keep.value;
      el.focus();
      el.setSelectionRange?.(keep.start, keep.end);
    }
  });
}

function showTab(tab) {
  state.tab = tab;
  document.querySelectorAll('[role=tab]').forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === tab));
  document.querySelectorAll('.tab').forEach((s) => { s.hidden = s.id !== `tab-${tab}`; });
  render();
}
document.querySelectorAll('[role=tab]').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));

// --- Netz-Erkennung -----------------------------------------------------------
async function detect() {
  // Erst die LNA-Freigabe abwarten, sonst laufen alle Probes hinter der Abfrage in den Timeout
  if (state.lna !== 'granted' && state.lna !== 'unsupported') {
    const known = Object.values(state.scans)[0]?.gateway;
    state.lna = 'checking';
    render();
    state.lna = await ensureLocalAccess(`http://${known || '192.168.178.1'}/`, () => { state.lna = 'prompt'; render(); });
    render();
    if (state.lna === 'denied' || state.lna === 'dismissed') return;
  }
  const nets = [...new Set([...CANDIDATE_NETS, ...state.customNets, ...Object.keys(state.scans)])];
  for (const cidr of nets) {
    if (!state.nets.has(cidr)) state.nets.set(cidr, { cidr, status: state.customNets.includes(cidr) ? 'checking' : 'unknown', candidates: [] });
  }
  state.detect = { running: true, done: 0, total: 0 };
  render();
  const results = await detectNetworks(nets, {
    onUpdate: (res) => { state.nets.set(res.cidr, { ...res }); render(); },
    onProgress: (done, total) => { state.detect.done = done; state.detect.total = total; render(); },
  });
  for (const r of results) state.nets.set(r.cidr, r);
  state.detect.running = false;
  render();
}

// --- Scan -----------------------------------------------------------------------
const PHASES = { calibrate: 'Kalibriere am Gateway', discovery: 'Suche Geräte', ports: 'Prüfe Ports', fingerprint: 'Erkenne Geräte', done: 'fertig', aborted: 'abgebrochen' };

function setProgress(p) {
  const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
  $('progressBar').style.width = `${pct}%`;
  $('progressText').textContent = `${state.activeCidr} · ${PHASES[p.phase] || p.phase} · ${state.devices.size} Geräte · ${pct} %`;
}

function startScan(cidr) {
  if (state.scanning) return;
  if (state.lna === 'denied' || state.lna === 'dismissed') { showToast('Zugriff aufs lokale Netz ist nicht erlaubt'); return; }
  const gateway = state.nets.get(cidr)?.gateway || state.scans[cidr]?.gateway;
  const ports = state.selectedPorts;
  if (!ports.length) { showToast('Keine Ports gewählt'); return; }
  const scan = new NetScan(cidr, { gateway, ports, profile: state.settings.profile });
  Object.assign(state, { scan, scanning: true, activeCidr: scan.cidr, devices: scan.devices, gateway: scan.gateway, cal: null });
  $('progress').hidden = false;
  scan.addEventListener('progress', (e) => { setProgress(e.detail); });
  scan.addEventListener('calibrated', (e) => { state.cal = e.detail; render(); });
  scan.addEventListener('device', render);
  scan.addEventListener('update', render);
  scan.addEventListener('done', (e) => {
    state.scanning = false;
    state.lastAt = Date.now();
    $('progress').hidden = true;
    const saved = { cidr: scan.cidr, at: state.lastAt, gateway: scan.gateway, cal: scan.cal, profile: scan.profile, ports: scan.ports.length, aborted: e.detail.aborted, devices: [...scan.devices.values()] };
    store.saveScan(scan.cidr, saved);
    state.scans[scan.cidr] = saved;
    showToast(e.detail.aborted ? 'Scan abgebrochen' : `Scan fertig: ${scan.devices.size} Geräte`);
    render();
  });
  showTab('uebersicht');
  scan.run().catch((err) => { showToast(`Fehler: ${err.message}`); state.scanning = false; render(); });
}

function showSaved(cidr) {
  const s = state.scans[cidr];
  if (!s) return;
  Object.assign(state, {
    activeCidr: cidr, gateway: s.gateway, cal: s.cal, lastAt: s.at,
    devices: new Map(s.devices.map((d) => [d.ip, d])),
  });
  showTab('uebersicht');
}

$('stopBtn').addEventListener('click', () => state.scan?.stop());

// --- Aktionen in der Netze-Ansicht (Delegation, da neu gerendert wird) ----------
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-scan],[data-show],[data-remove],[data-profile],[data-retry],#redetect');
  if (!t) return;
  if (t.hasAttribute('data-retry')) {
    state.lna = null;
    detect();
  } else if (t.dataset.profile) {
    state.settings = store.saveSettings({ profile: t.dataset.profile });
    render();
  } else if (t.dataset.scan) startScan(t.dataset.scan);
  else if (t.dataset.show) showSaved(t.dataset.show);
  else if (t.dataset.remove) {
    store.removeCustomNet(t.dataset.remove);
    state.customNets = store.customNets();
    if (state.nets.get(t.dataset.remove)?.status !== 'connected') state.nets.delete(t.dataset.remove);
    render();
  } else if (t.id === 'redetect') detect();
});

document.addEventListener('submit', (e) => {
  if (e.target.id !== 'addNetForm') return;
  e.preventDefault();
  try {
    const { cidr } = parseCidr($('addNet').value);
    store.addCustomNet(cidr);
    state.customNets = store.customNets();
    if (!state.nets.has(cidr)) state.nets.set(cidr, { cidr, status: 'custom', candidates: [] });
    $('addNet').value = '';
    render();
  } catch (err) {
    showToast(err.message);
  }
});

document.addEventListener('input', (e) => {
  if (e.target.id !== 'customPorts') return;
  state.settings = store.saveSettings({ customPorts: e.target.value });
  render();
});

$('search').addEventListener('input', render);
initGeraete(render);

// Bekannte Netze aus früheren Scans sofort zeigen, dann suchen
for (const cidr of Object.keys(state.scans)) state.nets.set(cidr, { cidr, status: 'unknown', candidates: [], gateway: state.scans[cidr].gateway });
render();
detect();

// Öffentliche IP: unabhängig vom Netz, einmal pro Seitenaufruf
state.whoami = { loading: true };
fetch('api/whoami', { cache: 'no-store' })
  .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status))))
  .then((w) => { state.whoami = w; })
  .catch(() => { state.whoami = { error: true }; })
  .finally(render);
