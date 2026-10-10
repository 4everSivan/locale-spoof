// Bridge between chrome.storage (isolated world) and inject.js (main world).
//
// Security model:
// 1. At document_start (before any page script runs) we synchronously drop a
//    random channel key as a data attribute on <html>. inject.js (declared
//    after this script) reads and removes it immediately, so the page never
//    observes it.
// 2. Every config push is authenticated with a MAC keyed by that secret:
//    a page can still *see* update events, but cannot forge a payload such as
//    { enabled: false } to switch the protection off.
// 3. The canvas noise salt is never sent in clear; it is XOR-stream encrypted
//    with the same key so page listeners cannot recover it.
(() => {
  const EV_NAME = '__LOCALE_SPOOF_UPDATE__';
  const ATTR_PREFIX = 'data-lsc-';
  const KEY_ATTR = 'data-lsc-k1';

  // -- MAC + stream cipher (must stay byte-identical to inject.js) --
  function mac(key, msg) {
    let h1 = 0x9e3779b9 ^ key.length;
    let h2 = 0x85ebca6b ^ (key.length << 7);
    const s = msg + '|' + key;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 2654435761) ^ (h2 >>> 7);
      h2 = Math.imul(h2 ^ c, 1597334677) ^ (h1 << 5);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507); h1 ^= h1 >>> 13;
    h2 = Math.imul(h2 ^ (h2 >>> 16), 3266489917); h2 ^= h2 >>> 16;
    return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
  }

  function xorStream(key, str) {
    let h = 0x12345678 ^ key.length;
    for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
    let out = '';
    for (let i = 0; i < str.length; i++) {
      h = Math.imul(h ^ (i + 0x9e37), 2246822519);
      h ^= h >>> 13;
      h = Math.imul(h, 3266489917);
      h ^= h >>> 16;
      out += String.fromCharCode((str.charCodeAt(i) ^ key.charCodeAt(i % key.length) ^ (h & 0xff)) & 0xffff);
    }
    return out;
  }

  // -- One-time key handshake, synchronously before inject.js runs --
  let CHANNEL_KEY = null;
  try {
    const de = document.documentElement;
    if (de) {
      const buf = new Uint8Array(16);
      if (self.crypto && crypto.getRandomValues) {
        crypto.getRandomValues(buf);
      } else {
        for (let i = 0; i < buf.length; i++) buf[i] = (Math.random() * 256) | 0;
      }
      CHANNEL_KEY = Array.from(buf, b => b.toString(16).padStart(2, '0')).join('');
      de.setAttribute(KEY_ATTR, CHANNEL_KEY);
      // Safety net: if inject.js never ran (crash / blocked), never leave the
      // key sitting in the DOM for the page to read.
      setTimeout(() => {
        try { de.removeAttribute(KEY_ATTR); } catch (e) {}
      }, 2000);
    }
  } catch (e) {
    CHANNEL_KEY = null;
  }

  function push() {
    if (!CHANNEL_KEY) return;
    chrome.storage.local.get(null, (stored) => {
      if (!CHANNEL_KEY) return;
      stored = stored || {};
      const salt = typeof stored.salt === 'string' ? stored.salt : '';
      const cfg = Object.assign({}, stored);
      delete cfg.salt;
      const saltEnc = salt ? xorStream(CHANNEL_KEY, salt) : null;
      const payload = { cfg: cfg || null, saltEnc: saltEnc || null };
      const detail = { cfg: payload.cfg, saltEnc: payload.saltEnc, mac: mac(CHANNEL_KEY, JSON.stringify(payload)) };
      window.dispatchEvent(new CustomEvent(EV_NAME, { detail }));
    });
  }

  // Initial config (async storage read; inject.js keeps safe defaults meanwhile)
  push();

  // Real-time updates when the user toggles settings in the popup
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') push();
  });

  // Handle hostname query from popup as fallback
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.type === '__GET_TAB_HOSTNAME__') {
      sendResponse({ hostname: location.hostname || '' });
    }
  });
})();
