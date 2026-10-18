// Local Network Access (Chrome/Edge): Solange die Abfrage „Geräte im lokalen Netz"
// offen ist, hängen alle Anfragen – Probes würden in den Timeout laufen.
// Deshalb vor dem ersten Scan auf die Entscheidung warten. Messung: docs/LNA-https-test.md
const NAMES = ['local-network-access', 'local-network'];

const IS_LOOPBACK = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/.test(location.hostname);

async function permissionStatus() {
  for (const name of NAMES) {
    try { return await navigator.permissions.query({ name }); } catch { /* Name unbekannt */ }
  }
  return null;
}

// Ergebnis: 'granted' | 'denied' | 'dismissed' | 'unsupported'
export async function ensureLocalAccess(triggerUrl, onPrompt) {
  // Von localhost aus gilt LNA nicht (Chrome meldet trotzdem „denied")
  if (IS_LOOPBACK) return 'unsupported';
  const st = await permissionStatus();
  if (!st) return 'unsupported'; // Firefox, Safari, ältere Chrome-Versionen
  if (st.state !== 'prompt') return st.state;

  onPrompt?.();
  return new Promise((resolve) => {
    const done = () => { if (st.state !== 'prompt') resolve(st.state); };
    st.addEventListener('change', done);
    // Eine Anfrage löst die Abfrage aus. Endet sie, während noch „prompt" gilt,
    // wurde die Abfrage ohne Entscheidung geschlossen.
    fetch(triggerUrl, { mode: 'no-cors', cache: 'no-store', credentials: 'omit', targetAddressSpace: 'local' })
      .catch(() => {})
      .finally(() => setTimeout(() => resolve(st.state === 'prompt' ? 'dismissed' : st.state), 50));
  });
}
