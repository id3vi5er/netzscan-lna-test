// Weboberflächen: Kacheln mit Favicon – eine Art Startseite fürs Heimnetz
import { esc, ipPort } from '../copy.js';
import { CATEGORIES, webUrl } from '../ports.js';
import { services } from './dienste.js';

const COPY_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5" y="5" width="9" height="9" rx="1.5"/><path d="M3 11V3.5A1.5 1.5 0 0 1 4.5 2H11"/></svg>';

// Favicon-Ergebnis merken, damit Neuzeichnen nicht jedes Mal neu lädt.
// Hinweis: Von einer HTTPS-Seite stuft Chrome http://-Bilder auf https:// hoch –
// dann scheitert das Favicon und die Kachel zeigt den Buchstaben.
const favState = new Map(); // url → 'ok' | 'fail'

const GENERIC = /^HTTPS?( \(|$)/;

function tile(x) {
  const { url } = webUrl(x.ip, x.p.port);
  const fav = new URL('favicon.ico', url).href;
  const ipp = ipPort(x.ip, x.p.port);
  const generic = GENERIC.test(x.info.label) || x.info.unknown;
  const title = x.info.recognized ? x.info.label : generic ? x.device.name || 'Weboberfläche' : x.info.label;
  const letter = (title === 'Weboberfläche' ? x.ip.split('.').pop() : title[0]).toUpperCase();
  const icon = favState.get(fav) === 'fail'
    ? `<span class="fav letter cat-${x.category}">${esc(letter)}</span>`
    : `<img class="fav" src="${esc(fav)}" alt="" referrerpolicy="no-referrer" data-fav="${esc(fav)}" data-letter="${esc(letter)}">`;
  return `
    <div class="tile ${x.p.state === 'open-http' ? '' : 'low'}">
      <a class="tile-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer">
        ${icon}
        <span class="tile-text">
          <span class="tile-title">${esc(title)}${x.device.isGatewayGuess ? ' <span class="tag role-gateway">Gateway?</span>' : ''}</span>
          <span class="tile-addr mono">${esc(url.replace(/\/$/, ''))}</span>
          <span class="tile-cat muted">${CATEGORIES[x.category].icon} ${esc(CATEGORIES[x.category].label)}${x.p.state === 'open-http' ? '' : ' · Zertifikat prüfen'}</span>
        </span>
      </a>
      <button class="copy" type="button" data-copy="${esc(ipp)}" aria-label="${esc(ipp)} kopieren" title="${esc(ipp)} kopieren">${COPY_ICON}</button>
    </div>`;
}

export function renderWeb(el, s) {
  const list = services(s.devices).filter((x) => x.web);
  if (!list.length) {
    el.innerHTML = `<p class="empty">${s.scanning ? 'Scan läuft…' : 'Noch keine Weboberflächen gefunden.'}</p>`;
    return;
  }
  el.innerHTML = `
    <p class="note top">Klick öffnet die Oberfläche in einem neuen Tab. HTTPS-Geräte nutzen meist ein eigenes Zertifikat – der Browser fragt dann einmal nach.</p>
    <div class="tiles">${list.map(tile).join('')}</div>`;
  el.querySelectorAll('img.fav').forEach((img) => {
    const mark = (ok) => {
      favState.set(img.dataset.fav, ok ? 'ok' : 'fail');
      if (!ok) img.outerHTML = `<span class="fav letter">${esc(img.dataset.letter)}</span>`;
    };
    if (img.complete) mark(img.naturalWidth > 0);
    else {
      img.addEventListener('load', () => mark(img.naturalWidth > 0), { once: true });
      img.addEventListener('error', () => mark(false), { once: true });
    }
  });
}
