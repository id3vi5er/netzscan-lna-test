// Dienste: gruppiert nach Kategorie, darin nach Dienst
import { copyable, esc } from '../copy.js';
import { CATEGORIES, CATEGORY_ORDER, serviceInfo } from '../ports.js';
import { ipToInt } from '../probe.js';
import { openPorts } from '../scan.js';
import { portChip } from './geraete.js';

// Flache Liste aller offenen Ports mit Dienstinfo
export function services(devices) {
  const out = [];
  for (const d of devices.values()) {
    for (const p of openPorts(d)) {
      const info = serviceInfo(p);
      out.push({
        ip: d.ip, device: d, p, info,
        category: info.category,
        web: p.state === 'open-http' || (p.state === 'open' && p.scheme === 'https'),
      });
    }
  }
  return out.sort((a, b) => ipToInt(a.ip) - ipToInt(b.ip) || a.p.port - b.p.port);
}

function confidence(x) {
  if (x.p.state === 'open-http') return '<span class="conf high" title="HTTP-Antwort erhalten">sicher</span>';
  return `<span class="conf low" title="Nur über das Zeitverhalten erkannt (${x.p.ms} ms)">vermutet</span>`;
}

export function renderDienste(el, s) {
  const list = services(s.devices);
  if (!list.length) {
    el.innerHTML = `<p class="empty">${s.scanning ? 'Scan läuft – Dienste erscheinen, sobald Ports gefunden werden.' : 'Noch keine Dienste. Unter „Netze" ein Netz scannen.'}</p>`;
    return;
  }
  const byCat = new Map(CATEGORY_ORDER.map((c) => [c, []]));
  for (const x of list) (byCat.get(x.category) || byCat.get('other')).push(x);

  const nav = CATEGORY_ORDER.filter((c) => byCat.get(c).length).map((c) =>
    `<a href="#cat-${c}" class="catlink"><span class="ico">${CATEGORIES[c].icon}</span>${esc(CATEGORIES[c].label)} <span class="count">${byCat.get(c).length}</span></a>`).join('');

  const sections = CATEGORY_ORDER.filter((c) => byCat.get(c).length).map((c) => {
    // Innerhalb der Kategorie nach Dienst (Port + Name) gruppieren, häufigste zuerst
    const groups = new Map();
    for (const x of byCat.get(c)) {
      const key = `${x.info.label}|${x.p.port}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(x);
    }
    const sorted = [...groups.entries()].sort((a, b) => b[1].length - a[1].length || a[1][0].p.port - b[1][0].p.port);
    return `
      <section class="svc-cat" id="cat-${c}">
        <h2 class="section"><span class="ico">${CATEGORIES[c].icon}</span>${esc(CATEGORIES[c].label)} <span class="count">${byCat.get(c).length}</span></h2>
        <div class="svc-groups">
          ${sorted.map(([, items]) => `
            <article class="card svc">
              <header>
                <h3>${esc(items[0].info.label)}</h3>
                <span class="mono muted">Port ${items[0].p.port}</span>
                <span class="count">${items.length}</span>
              </header>
              <ul class="svc-rows">
                ${items.map((x) => `
                  <li>
                    ${copyable(x.ip, x.ip, 'mono')}
                    ${x.device.name && x.device.name !== x.info.label ? `<span class="small muted ellip">${esc(x.device.name)}</span>` : ''}
                    ${x.device.isGatewayGuess ? '<span class="tag role-gateway">Gateway?</span>' : ''}
                    <span class="grow"></span>
                    ${confidence(x)}
                    ${portChip(x.ip, x.p)}
                  </li>`).join('')}
              </ul>
            </article>`).join('')}
        </div>
      </section>`;
  }).join('');

  el.innerHTML = `<nav class="catnav">${nav}</nav>${sections}`;
}
