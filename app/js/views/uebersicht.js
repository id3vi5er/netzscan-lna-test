// Übersicht eines Netzes: vermutetes Gateway, Eckdaten, Messgrundlage
import { copyable, esc } from '../copy.js';
import { openPorts } from '../scan.js';
import { gatewayLink } from './netze.js';
import { portChip } from './geraete.js';

// Öffentliche IP kommt von der Mini-API (server/whoami.py), die die Anfrage-IP sieht
function publicCard(w) {
  let body;
  if (!w || w.loading) body = '<p class="note">Frage den Server…</p>';
  else if (w.error) body = '<p class="note">Nicht verfügbar – die Mini-API läuft nur auf learn.pwr-core.de.</p>';
  else if (w.local) body = '<p class="note">Lokal gestartet: Der Server sieht nur eine lokale Adresse. Die öffentliche IP erscheint erst auf learn.pwr-core.de.</p>';
  else {
    body = `
      <div class="big-ip">${copyable(w.ip, w.ip, 'mono')}</div>
      <dl class="kv small">
        <dt>Protokoll</dt><dd>IPv${w.version}</dd>
        ${w.org ? `<dt>Provider</dt><dd>${esc(w.org)}${w.asn ? ` <span class="muted">AS${w.asn}</span>` : ''}</dd>` : ''}
        ${w.hostname ? `<dt>Hostname</dt><dd class="mono ellip" title="${esc(w.hostname)}">${esc(w.hostname)}</dd>` : ''}
      </dl>
      <p class="note">Das ist die Adresse, über die dein Browser den Server erreicht hat${w.version === 6 ? ' (IPv6 – die IPv4 kann abweichen)' : ''}.</p>`;
  }
  return `<article class="card role public"><header><span class="ico">⇅</span><h3>Öffentliche IP</h3></header>${body}</article>`;
}

export function renderUebersicht(el, s) {
  const cidr = s.activeCidr;
  if (!cidr) {
    el.innerHTML = '<p class="empty">Noch kein Netz gewählt. Unter „Netze" eines scannen.</p>';
    return;
  }
  const devs = [...s.devices.values()];
  const gwIp = s.gateway;
  const gw = s.devices.get(gwIp);
  const gwPorts = gw ? openPorts(gw) : (s.nets.get(cidr)?.candidates?.find((c) => c.ip === gwIp)?.ports || []);
  const link = gwIp && gatewayLink(gwIp, gwPorts);
  const webCount = devs.filter((d) => openPorts(d).some((p) => p.state === 'open-http')).length;
  const portCount = devs.reduce((n, d) => n + openPorts(d).length, 0);
  // Weitere Infrastruktur: erkannte Router/Repeater und Router-typische Adressen mit Weboberfläche
  const otherRouters = devs.filter((d) => d.ip !== gwIp && (d.type === 'router'
    || (/\.(1|254)$/.test(d.ip) && openPorts(d).some((p) => p.port === 80 || p.port === 443))));
  const meshOnly = otherRouters.length && otherRouters.every((d) => /Repeater|Mesh/.test(d.name || ''));
  const dnsFilters = devs.filter((d) => openPorts(d).some((p) => /Pi-hole|AdGuard/.test(p.service?.name || '')));
  const cal = s.cal;

  el.innerHTML = `
    <div class="grid-hero">
      <article class="card hero">
        <div class="hero-main">
          <div class="eyebrow">Internet-Gateway · vermutet${gw?.vendor ? ' · ' + esc(gw.vendor) : ''}</div>
          <h2>${gw?.name ? esc(gw.name) : gw || gwPorts.length ? 'Router / Gateway' : 'Gateway antwortet nicht'}</h2>
          <div class="hero-ip">${gwIp ? copyable(gwIp, gwIp, 'mono big') : '—'}</div>
          <div class="chips">${gwPorts.filter((p) => p.state === 'open-http' || p.state === 'open').map((p) => portChip(gwIp, p)).join('')}</div>
        </div>
        <dl class="kv">
          <dt>Netz</dt><dd class="mono">${esc(cidr)}</dd>
          ${link ? `<dt>Oberfläche</dt><dd><a href="${esc(link)}" target="_blank" rel="noopener noreferrer">${esc(link)} ↗</a></dd>` : ''}
          <dt>Warum vermutet?</dt><dd class="small muted">Browser kennen die Routing-Tabelle nicht. Als Gateway gilt die antwortende <code>.1</code> bzw. <code>.254</code>.</dd>
        </dl>
      </article>
      <article class="card stats">
        <div><span class="num">${devs.length}</span><span class="lbl">Geräte${s.scanning ? ' (Scan läuft)' : ''}</span></div>
        <div><span class="num">${webCount}</span><span class="lbl">mit Weboberfläche</span></div>
        <div><span class="num">${portCount}</span><span class="lbl">offene Ports</span></div>
        <div><span class="num">${s.lastAt ? new Date(s.lastAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : '—'}</span><span class="lbl">letzter Scan</span></div>
      </article>
    </div>

    <h2 class="section">Internetanschluss &amp; Infrastruktur</h2>
    <div class="grid-cards">
      ${publicCard(s.whoami)}
      <article class="card role"><header><span class="ico">⌬</span><h3>Weitere Router &amp; Repeater</h3></header>
        ${otherRouters.length ? `<ul class="plain">${otherRouters.map((d) => `<li>${copyable(d.ip, d.ip, 'mono')}<span class="muted small">${esc(d.name || 'Router-Oberfläche')}</span></li>`).join('')}</ul>
          <p class="note">${meshOnly ? 'Mesh-Repeater des Gateways – das ist kein Doppel-NAT.' : 'Ein zweiter Router kann Doppel-NAT bedeuten: Portfreigaben müssen dann auf beiden Geräten eingerichtet werden.'}</p>`
          : '<p class="note">Keine weiteren Router gefunden.</p>'}
      </article>
      <article class="card role"><header><span class="ico">⌕</span><h3>DNS-Filter</h3></header>
        ${dnsFilters.length ? `<ul class="plain">${dnsFilters.map((d) => `<li>${copyable(d.ip, d.ip, 'mono')}<span class="muted small">${esc(d.name)}</span></li>`).join('')}</ul>
          <p class="note">Ob deine Geräte ihn wirklich nutzen, kann der Browser nicht prüfen.</p>`
          : '<p class="note">Kein Pi-hole oder AdGuard Home erkannt. Welcher DNS-Server tatsächlich genutzt wird, ist im Browser nicht sichtbar.</p>'}
      </article>
    </div>

    <h2 class="section">Was der Browser sehen kann</h2>
    <div class="grid-cards">
      <article class="card role"><header><span class="ico">✓</span><h3>Erkennbar</h3></header>
        <ul class="plain small">
          <li>Geräte mit mindestens einem erreichbaren TCP-Port</li>
          <li>Weboberflächen (HTTP/HTTPS) – sicher</li>
          <li>andere offene Ports – nur über das Zeitverhalten</li>
        </ul></article>
      <article class="card role"><header><span class="ico">✕</span><h3>Nicht erkennbar</h3></header>
        <ul class="plain small">
          <li>MAC-Adressen – außer das Gerät meldet sie selbst (Shelly Gen2+, WLED, Tasmota)</li>
          <li>DHCP- und DNS-Server</li>
          <li>Geräte, die alle Ports verwerfen (z. B. Handys im Ruhezustand)</li>
          <li>SSH, FTP, Telnet u. a. – vom Browser gesperrte Ports</li>
        </ul></article>
      <article class="card role"><header><span class="ico">⏱</span><h3>Messgrundlage</h3></header>
        ${cal ? `<dl class="kv small">
          <dt>RST-Zeit</dt><dd>${cal.rstMs} ms ${cal.measured ? '(gemessen)' : '(Standardwert)'}</dd>
          <dt>Timeout</dt><dd>${cal.timeout} ms</dd>
          <dt>Modus</dt><dd>${cal.slowRst ? 'offen / geschlossen unterscheidbar' : 'schnelles RST – Nicht-HTTP-Ports nur „Host lebt"'}</dd>
        </dl>` : '<p class="note">Wird beim Scan am Gateway gemessen.</p>'}</article>
    </div>`;
}
