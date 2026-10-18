// Geräteliste: IP und IP:Port kopierbar, Weboberflächen verlinkt
import { copyable, esc, formatMac, ipPort } from '../copy.js';
import { ipToInt } from '../probe.js';
import { serviceInfo, webUrl } from '../ports.js';
import { openPorts } from '../scan.js';

const COPY_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5" y="5" width="9" height="9" rx="1.5"/><path d="M3 11V3.5A1.5 1.5 0 0 1 4.5 2H11"/></svg>';

export const TYPE_ICON = { router: '⌬', switch: '⏻', sensor: '◔', light: '✺', server: '▣', service: '◫', media: '▶', printer: '⎙' };
export const TYPE_LABEL = { router: 'Router', switch: 'Schaltaktor / Steckdose', sensor: 'Sensor', light: 'Licht', server: 'Server', service: 'Dienst', media: 'Medien', printer: 'Drucker' };

let sortKey = 'ip';
let sortDir = 1;

// Port-Chip: Portnummer (verlinkt bei HTTP/HTTPS) + Kopieren von IP:Port
export function portChip(ip, p) {
  const ipp = ipPort(ip, p.port);
  const web = p.state === 'open-http' || (p.state === 'open' && p.scheme === 'https');
  const how = p.state === 'open-http'
    ? `${p.scheme.toUpperCase()}-Antwort in ${p.ms} ms`
    : `nur über Zeitverhalten erkannt (Fehler nach ${p.ms} ms)${p.scheme === 'https' ? ' – vermutlich HTTPS mit eigenem Zertifikat' : ''}`;
  const title = `${serviceInfo(p).label} · ${how}`;
  const label = web
    ? `<a href="${esc(webUrl(ip, p.port).url)}" target="_blank" rel="noopener noreferrer">${p.port}</a>`
    : `<span>${p.port}</span>`;
  return `<span class="chip ${p.state === 'open-http' ? 'http' : 'low'}" title="${esc(title)}">${label}` +
    `<button class="copy" type="button" data-copy="${esc(ipp)}" aria-label="${esc(ipp)} kopieren" title="${esc(ipp)} kopieren">${COPY_ICON}</button></span>`;
}

function compare(a, b) {
  let r;
  if (sortKey === 'ports') r = openPorts(a).length - openPorts(b).length;
  else if (sortKey === 'lastSeen') r = a.lastSeen - b.lastSeen;
  else r = ipToInt(a.ip) - ipToInt(b.ip);
  return (r || ipToInt(a.ip) - ipToInt(b.ip)) * sortDir;
}

export function initGeraete(onChange) {
  document.querySelectorAll('table.devices th[data-sort]').forEach((th) => th.addEventListener('click', () => {
    const k = th.dataset.sort;
    sortDir = sortKey === k ? -sortDir : 1;
    sortKey = k;
    onChange();
  }));
}

export function renderGeraete(body, empty, devices, query) {
  const q = query.trim().toLowerCase();
  const list = [...devices.values()].filter((d) => {
    if (!q) return true;
    const hay = [d.ip, d.name, d.mac, formatMac(d.mac), d.model, d.vendor, d.isGatewayGuess ? 'gateway router' : '', ...openPorts(d).map((p) => `${p.port} ${d.ip}:${p.port}`)]
      .filter(Boolean).join(' ').toLowerCase();
    return hay.includes(q);
  }).sort(compare);

  document.querySelectorAll('table.devices th[data-sort]').forEach((th) => {
    th.classList.toggle('sorted', th.dataset.sort === sortKey);
    th.dataset.dir = sortDir > 0 ? 'asc' : 'desc';
  });

  empty.hidden = list.length > 0;
  empty.textContent = devices.size ? 'Keine Treffer.' : 'Noch keine Geräte. Unter „Netze" ein Netz scannen.';
  body.innerHTML = list.map((d) => {
    const ports = openPorts(d);
    const alive = Object.values(d.ports).some((p) => p.state === 'closed' || p.state === 'alive');
    return `
    <tr class="${d.isGatewayGuess ? 'is-gw' : ''}">
      <td>${copyable(d.ip, d.ip, 'mono')}</td>
      <td class="namecell">
        <span class="dtype" title="${esc(TYPE_LABEL[d.type] || 'unbekannt')}">${TYPE_ICON[d.type] || '·'}</span>
        <span class="nameblock">
          <span>${d.name ? `<span title="${esc(d.via ? 'erkannt über ' + d.via : '')}">${esc(d.name)}</span>` : '<span class="muted">—</span>'}${d.isGatewayGuess ? ' <span class="tag role-gateway">Gateway?</span>' : ''}</span>
          ${d.model || d.fw ? `<span class="small muted">${esc([d.model, d.fw && 'FW ' + d.fw].filter(Boolean).join(' · '))}</span>` : ''}
        </span>
      </td>
      <td>${d.mac ? copyable(formatMac(d.mac), formatMac(d.mac), 'mono') + (d.macSource === 'device-api' ? ' <span class="tag" title="Vom Gerät selbst gemeldet">Gerät</span>' : '') : '<span class="muted" title="Im Browser nur auslesbar, wenn das Gerät sie selbst meldet (Shelly Gen2+, WLED, Tasmota)">—</span>'}</td>
      <td class="chips">${ports.map((p) => portChip(d.ip, p)).join('')}${!ports.length && alive ? '<span class="muted small" title="Antwortet, aber kein offener Port aus der Liste">lebt, keine offenen Ports</span>' : ''}</td>
      <td class="small muted">${new Date(d.lastSeen).toLocaleTimeString('de-DE')}</td>
    </tr>`;
  }).join('');
}
