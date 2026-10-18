// Kopieren in die Zwischenablage + Rückmeldung
const toast = document.getElementById('toast');
let toastTimer;

export function showToast(text) {
  toast.textContent = text;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 1600);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  showToast(`${text} kopiert`);
}

// IPv6 braucht eckige Klammern vor dem Port
export const ipPort = (ip, port) => (ip.includes(':') ? `[${ip}]:${port}` : `${ip}:${port}`);

let macFormat = 'colon';
try { macFormat = localStorage.getItem('netzscan.macFormat') || 'colon'; } catch {}

export function setMacFormat(f) {
  macFormat = f;
  try { localStorage.setItem('netzscan.macFormat', f); } catch {}
}
export const getMacFormat = () => macFormat;

export function formatMac(mac) {
  if (!mac) return '';
  if (macFormat === 'dash') return mac.toLowerCase().replaceAll(':', '-');
  if (macFormat === 'plain') return mac.toLowerCase().replaceAll(':', '');
  return mac;
}

// Ein Wert mit Kopier-Button daneben; data-copy trägt den Kopiertext
export function copyable(value, copyValue = value, cls = '') {
  if (!value) return '<span class="muted">—</span>';
  return `<span class="copyable ${cls}"><span class="val">${esc(value)}</span>` +
    `<button class="copy" type="button" data-copy="${esc(copyValue)}" title="${esc(copyValue)} kopieren" aria-label="${esc(copyValue)} kopieren">` +
    `<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5" y="5" width="9" height="9" rx="1.5"/><path d="M3 11V3.5A1.5 1.5 0 0 1 4.5 2H11"/></svg></button></span>`;
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Ein Listener für alle Kopier-Buttons der Seite
document.addEventListener('click', (e) => {
  const btn = e.target.closest('button.copy');
  if (!btn) return;
  copyText(btn.dataset.copy);
  btn.classList.add('done');
  setTimeout(() => btn.classList.remove('done'), 900);
});
