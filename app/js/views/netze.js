// Startansicht: erkannte Netze mit vermutetem Gateway
import { copyable, esc } from '../copy.js';
import { BLOCKED_KNOWN, PROFILES, parsePortList, webUrl } from '../ports.js';
import { openPorts } from '../scan.js';

function ago(ts) {
  if (!ts) return '';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'gerade eben';
  if (s < 3600) return `vor ${Math.round(s / 60)} min`;
  if (s < 86400) return `vor ${Math.round(s / 3600)} h`;
  return new Date(ts).toLocaleDateString('de-DE');
}

export function gatewayLink(ip, ports) {
  const web = ports.find((p) => p.state === 'open-http') || ports.find((p) => p.state === 'open' && p.scheme === 'https');
  return web ? webUrl(ip, web.port).url : null;
}

function netRow(n, { scans, scanningCidr, activeCidr, custom }) {
  const last = scans[n.cidr];
  const gwCand = n.candidates?.find((c) => c.ip === n.gateway);
  const gwIp = n.gateway || last?.gateway;
  const link = gwCand ? gatewayLink(gwIp, gwCand.ports) : null;
  const status = n.status === 'connected'
    ? '<span class="tag ok" title="Unter .1 oder .254 antwortet ein Gerät – das Netz ist direkt oder über einen Router erreichbar">erreichbar</span>'
    : n.status === 'checking' ? '<span class="tag">prüfe…</span>'
    : n.status === 'none' ? '<span class="tag">keine Antwort</span>'
    : n.status === 'custom' ? '<span class="tag">noch nicht geprüft</span>'
    : '<span class="tag">…</span>';
  const devs = last?.devices || [];
  const web = devs.filter((d) => openPorts(d).some((p) => p.state === 'open-http')).length;
  return `
    <article class="card netrow ${n.cidr === activeCidr ? 'active' : ''}">
      <div class="net-main">
        <div class="net-cidr mono">${esc(n.cidr)}</div>
        <div class="tags">${status}${custom ? '<span class="tag">eigener Eintrag</span>' : ''}</div>
      </div>
      <dl class="kv">
        <dt>Gateway</dt><dd>${gwIp ? copyable(gwIp, gwIp, 'mono') : '<span class="muted">—</span>'}
          ${link ? `<a class="small-link" href="${esc(link)}" target="_blank" rel="noopener noreferrer">Oberfläche ↗</a>` : ''}
          ${gwIp ? '<span class="muted small" title="Im Browser nicht sicher bestimmbar: antwortende .1 bzw. .254">vermutet</span>' : ''}</dd>
        <dt>Letzter Scan</dt><dd>${last ? `${devs.length} Geräte · ${web} Weboberflächen · ${ago(last.at)}` : '<span class="muted">noch nicht gescannt</span>'}</dd>
      </dl>
      <div class="net-actions">
        ${last ? `<button class="btn" type="button" data-show="${esc(n.cidr)}">Ansehen</button>` : ''}
        <button class="btn primary" type="button" data-scan="${esc(n.cidr)}" ${scanningCidr ? 'disabled' : ''}>${scanningCidr === n.cidr ? 'Scan läuft…' : 'Scannen'}</button>
        ${custom ? `<button class="btn ghost" type="button" data-remove="${esc(n.cidr)}" title="Eintrag entfernen" aria-label="Eintrag entfernen">✕</button>` : ''}
      </div>
    </article>`;
}

// Scan-Profil: welche Ports im zweiten Durchgang geprüft werden
function profileCard(s) {
  const { profile, customPorts } = s.settings;
  const custom = parsePortList(customPorts);
  const count = (key) => (key === 'eigene' ? (custom.ports?.length ?? 0) : PROFILES[key].ports.length);
  const est = estimateSeconds(s.selectedPorts.length);
  return `
    <section class="card profile">
      <div class="profile-head">
        <h3>Port-Profil</h3>
        <div class="seg" role="radiogroup" aria-label="Port-Profil">
          ${Object.entries(PROFILES).map(([key, p]) => `
            <button type="button" role="radio" aria-checked="${profile === key}" data-profile="${key}">
              ${p.label} <span class="muted">${count(key)}</span></button>`).join('')}
        </div>
        <span class="muted small" title="Obergrenze für bis zu 16 Geräte; danach entsprechend länger">Port-Prüfung bis ≈ ${est} s</span>
      </div>
      ${profile === 'eigene' ? `
        <div class="custom-ports">
          <input id="customPorts" class="mono" value="${esc(customPorts)}" placeholder="80, 443, 8000-8100" spellcheck="false" autocomplete="off" aria-label="Eigene Ports">
          <span class="small ${custom.error ? 'err' : 'muted'}">${custom.error ? esc(custom.error)
            : `${custom.ports.length} Ports${custom.blocked.length ? ` · gesperrt und übersprungen: ${custom.blocked.slice(0, 12).join(', ')}${custom.blocked.length > 12 ? ' …' : ''}` : ''}`}</span>
        </div>` : ''}
      <p class="blocked small">Vom Browser gesperrt, nicht prüfbar:
        ${BLOCKED_KNOWN.map(([port, name]) => `<span class="chip off" title="Browser verweigern Verbindungen zu Port ${port} grundsätzlich">${name} ${port}</span>`).join(' ')}</p>
    </section>`;
}

// Grobe Obergrenze für die Port-Prüfung: geschlossene Ports kosten unter Windows
// ~2 s, 6 parallel pro Gerät, bis zu 16 Geräte gleichzeitig
function estimateSeconds(ports) {
  return Math.max(3, Math.round(Math.ceil(ports / 6) * 2.2));
}

function lnaBanner(lna) {
  if (lna === 'prompt' || lna === 'checking') {
    return `<div class="card lna wait"><b>Bitte im Browser oben „Erlauben" wählen.</b>
      Chrome fragt, ob diese Seite auf Geräte im lokalen Netz zugreifen darf. Die Suche startet danach automatisch.</div>`;
  }
  if (lna === 'denied' || lna === 'dismissed') {
    return `<div class="card lna denied"><b>${lna === 'denied' ? 'Zugriff aufs lokale Netz abgelehnt.' : 'Abfrage geschlossen, ohne zu erlauben.'}</b>
      Ohne diese Freigabe kann Netzscan nichts prüfen. ${lna === 'denied'
        ? 'Ändern: Symbol links in der Adressleiste → Website-Einstellungen → „Lokales Netzwerk" auf Zulassen, dann die Seite neu laden.'
        : ''}
      <button class="btn small" type="button" data-retry>Erneut versuchen</button></div>`;
  }
  return '';
}

export function renderNetze(el, s) {
  const custom = new Set(s.customNets);
  const shown = [...s.nets.values()].filter((n) => n.status === 'connected' || custom.has(n.cidr) || s.scans[n.cidr]);
  const checked = s.nets.size - custom.size;
  const detecting = s.detect.running;

  el.innerHTML = `
    <div class="intro">
      <h1>Netze in deiner Umgebung</h1>
      <p>Netzscan läuft komplett in deinem Browser und fragt von hier aus Adressen im lokalen Netz an.
        <b>Ergebnisse verlassen dein Gerät nicht.</b> Chrome und Edge fragen dafür einmal nach dem
        Zugriff auf „Geräte im lokalen Netz" – bitte erlauben.</p>
    </div>
    ${lnaBanner(s.lna)}
    ${detecting ? `<div class="card detect"><div class="bar"><span style="width:${Math.round((s.detect.done / (s.detect.total || 1)) * 100)}%"></span></div>
       <span>Suche Gateways in ${checked} typischen Heimnetzen… ${s.detect.done}/${s.detect.total}</span></div>` : ''}
    ${profileCard(s)}
    <div class="netlist">
      ${shown.map((n) => netRow(n, { ...s, custom: custom.has(n.cidr) })).join('')}
      ${!shown.length && !detecting ? `<p class="empty">Kein typisches Heimnetz hat geantwortet. Trage dein Netz unten ein (z. B. aus den Netzwerkeinstellungen deines Geräts).</p>` : ''}
    </div>
    <form class="addnet card" id="addNetForm">
      <label for="addNet">Netz hinzufügen</label>
      <input id="addNet" class="mono" placeholder="192.168.178.0/24" spellcheck="false" autocomplete="off">
      <button class="btn" type="submit">Hinzufügen</button>
      <button class="btn ghost" type="button" id="redetect" ${detecting ? 'disabled' : ''}>Erneut suchen</button>
    </form>
    <p class="note">Geprüft werden jeweils <code>.1</code> und <code>.254</code> auf Port 80 und 443 in ${checked} verbreiteten Netzen
      (Fritz!Box, Telekom, TP-Link, Unifi …). Ein Netz ohne antwortendes Gateway wird nicht angezeigt.</p>`;
}
