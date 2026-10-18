// Ablage im Browser. M1: localStorage (eigene Netze, letzter Scan je Netz).
// Historie und Notizen kommen mit M4 nach IndexedDB.
const KEY = 'netzscan.v1';

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
}
function save(data) {
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* privates Fenster o. Ä. */ }
}

const DEFAULT_SETTINGS = { profile: 'schnell', customPorts: '80, 443, 8000-8100' };

export function settings() { return { ...DEFAULT_SETTINGS, ...load().settings }; }

export function saveSettings(patch) {
  const d = load();
  d.settings = { ...DEFAULT_SETTINGS, ...d.settings, ...patch };
  save(d);
  return d.settings;
}

export function customNets() { return load().customNets || []; }

export function addCustomNet(cidr) {
  const d = load();
  d.customNets = [...new Set([...(d.customNets || []), cidr])];
  save(d);
}

export function removeCustomNet(cidr) {
  const d = load();
  d.customNets = (d.customNets || []).filter((c) => c !== cidr);
  save(d);
}

export function saveScan(cidr, scan) {
  const d = load();
  d.scans = { ...(d.scans || {}), [cidr]: scan };
  save(d);
}

export function lastScan(cidr) { return load().scans?.[cidr] || null; }
export function allScans() { return load().scans || {}; }
