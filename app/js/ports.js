// Dienst-Datenbank (data/ports.json): Namen, Kategorien, Profile, TLS-Ports

// Chrome/Firefox „Bad Ports" (fetch.spec.whatwg.org/#bad-port) – werden nie gesendet
export const BAD_PORTS = new Set([
  0, 1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95,
  101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161,
  179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563,
  587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060,
  5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6697, 10080,
]);

const data = await fetch(new URL('../data/ports.json', import.meta.url)).then((r) => r.json());

export const CATEGORIES = data.categories;
export const CATEGORY_ORDER = Object.keys(CATEGORIES);
const PORTS = data.ports;

export function portInfo(port) {
  return PORTS[port] || { label: `Port ${port}`, category: 'other', unknown: true };
}

// Erkannter Dienst (Fingerprint) hat Vorrang vor der Port-Tabelle
export function serviceInfo(p) {
  if (p.service) return { label: p.service.name, category: p.service.category, recognized: true };
  return portInfo(p.port);
}

export const isTls = (port) => !!PORTS[port]?.tls;

export function webUrl(ip, port) {
  const scheme = isTls(port) ? 'https' : 'http';
  const def = (scheme === 'http' && port === 80) || (scheme === 'https' && port === 443);
  const host = ip.includes(':') ? `[${ip}]` : ip;
  return { scheme, url: `${scheme}://${host}${def ? '' : ':' + port}${PORTS[port]?.path || '/'}` };
}

const allKnown = Object.keys(PORTS).map(Number).filter((p) => !BAD_PORTS.has(p)).sort((a, b) => a - b);

export const PROFILES = {
  schnell: { label: 'Schnell', ports: data.profiles.schnell },
  erweitert: { label: 'Erweitert', ports: allKnown },
  eigene: { label: 'Eigene Liste', ports: null },
};

export const MAX_CUSTOM_PORTS = 1000;

// "80, 443, 8000-8100" → { ports, blocked, error }
export function parsePortList(text) {
  const ports = new Set();
  const blocked = new Set();
  for (const part of String(text).split(/[\s,;]+/).filter(Boolean)) {
    const m = part.match(/^(\d{1,5})(?:-(\d{1,5}))?$/);
    if (!m) return { error: `„${part}" ist keine Portnummer` };
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    if (a < 1 || b > 65535 || b < a) return { error: `Ungültiger Bereich ${part}` };
    if (b - a > MAX_CUSTOM_PORTS) return { error: `Bereich ${part} zu groß (max. ${MAX_CUSTOM_PORTS} Ports)` };
    for (let p = a; p <= b; p++) (BAD_PORTS.has(p) ? blocked : ports).add(p);
  }
  if (ports.size > MAX_CUSTOM_PORTS) return { error: `Zu viele Ports (max. ${MAX_CUSTOM_PORTS})` };
  return { ports: [...ports].sort((a, b) => a - b), blocked: [...blocked].sort((a, b) => a - b) };
}

// Bekannte Dienste auf gesperrten Ports – zum Ausgrauen in der Oberfläche
export const BLOCKED_KNOWN = [
  [22, 'SSH'], [21, 'FTP'], [23, 'Telnet'], [53, 'DNS'], [25, 'SMTP'], [139, 'NetBIOS'],
  [548, 'AFP'], [554, 'RTSP'], [2049, 'NFS'], [5060, 'SIP'], [110, 'POP3'], [143, 'IMAP'],
];
