// Reports en-US language/locale and Buffalo, New York (America/New_York) timezone.
// Blocks WebRTC leaks (candidates, SDP & getStats) under proxy/TUN mode.
// Spoofs Geolocation prototype & types to match physical exit node coordinates.
// Injects per-site seeded noise into Canvas / OffscreenCanvas / WebGL readouts.
// Patches default-locale APIs (toLocaleString / localeCompare / Intl.*) to avoid OS-locale leaks.
// Stealth: hides patching from toString / name / length / constructor inspection.
// Config channel is MAC-authenticated, so pages cannot forge "disable" updates.
(() => {
  // Prevent duplicate execution inside the same window.
  // A Symbol is invisible to `in` checks and Object.keys scans.
  const FLAG = Symbol('lsc');
  if (typeof window === 'undefined') return;
  if (window[FLAG]) return;
  try { Object.defineProperty(window, FLAG, { value: 1 }); } catch (e) { return; }

  // =========================================================================
  // ---- Authenticated config channel ----
  // content.js drops a one-time random key as a data attribute on <html>
  // before this script runs (both at document_start, before page scripts)
  // and this script consumes + removes it immediately. Every config event
  // carries a MAC keyed with that secret, so a page can observe events but
  // cannot forge a payload (e.g. { enabled: false }).
  // =========================================================================
  const EV_NAME = '__LOCALE_SPOOF_UPDATE__';
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

  let CHANNEL_KEY = null;
  let SALT = '';
  try {
    const de = document.documentElement;
    if (de && de.attributes) {
      for (const attr of Array.from(de.attributes)) {
        if (attr.name && attr.name.indexOf('data-lsc-') === 0) {
          CHANNEL_KEY = attr.value;
          de.removeAttribute(attr.name);
        }
      }
    }
  } catch (e) {}

  // Config defaults matching user's proxy exit node
  let CONFIG = {
    enabled: true,
    whitelist: [],
    timezone: 'America/New_York',
    locationName: 'Buffalo, New York',
    latitude: 42.8864,
    longitude: -78.8784,
    locale: 'en-US',
    webrtcProtect: true,
    geoProtect: true,
    canvasProtect: true
  };
  let languagesCache = Object.freeze([CONFIG.locale, 'en']);

  function isSiteWhitelisted() {
    if (!Array.isArray(CONFIG.whitelist) || CONFIG.whitelist.length === 0) return false;
    let host = '';
    try {
      host = (location.hostname || '').toLowerCase();
    } catch (e) {
      return false;
    }
    if (!host) return false;
    return CONFIG.whitelist.some(item => {
      if (!item || typeof item !== 'string') return false;
      const d = item.trim().toLowerCase();
      return host === d || host.endsWith('.' + d);
    });
  }

  function isProtectionActive() {
    return !!(CONFIG.enabled && !isSiteWhitelisted());
  }

  function applyConfig(cfg) {
    CONFIG = Object.assign({}, CONFIG, cfg);
    if (!Array.isArray(CONFIG.whitelist)) CONFIG.whitelist = [];
    if (typeof CONFIG.locale !== 'string' || !CONFIG.locale) CONFIG.locale = 'en-US';
    // Same frozen instance across accesses, like the native getter
    languagesCache = Object.freeze([CONFIG.locale, 'en']);
  }

  // =========================================================================
  // ---- toString stealth engine (also fakes .name / .length) ----
  // =========================================================================
  const origToString = Function.prototype.toString;
  const nativeMap = new WeakMap();
  Function.prototype.toString = function toString() {
    if (nativeMap.has(this)) return nativeMap.get(this);
    return origToString.call(this);
  };
  nativeMap.set(Function.prototype.toString, 'function toString() { [native code] }');

  function markNative(fn, name, opts) {
    if (typeof fn !== 'function') return;
    const isGetter = !!(opts && opts.getter);
    nativeMap.set(
      fn,
      isGetter ? `function get ${name}() { [native code] }` : `function ${name}() { [native code] }`
    );
    try {
      Object.defineProperty(fn, 'name', { value: isGetter ? `get ${name}` : name, configurable: true });
    } catch (e) {}
    if (opts && typeof opts.length === 'number') {
      try { Object.defineProperty(fn, 'length', { value: opts.length, configurable: true }); } catch (e) {}
    }
  }

  // =========================================================================
  // ---- Timezone helpers (cached; original Intl captured before patching) ----
  // =========================================================================
  const OrigDate = window.Date;
  const OrigDateTimeFormat = window.Intl ? Intl.DateTimeFormat : null;

  const dtfCache = new Map();     // tz -> Intl.DateTimeFormat instance (offset parts)
  const tzNameCache = new Map();  // tz -> Intl.DateTimeFormat instance (zone names)
  const offsetCache = new Map();  // tz -> { lo, off } bucketed to 15 min
  const BUCKET_MS = 900000;

  function offsetMinutesEast(ms, tz) {
    if (isNaN(ms)) return NaN;
    const zone = tz || CONFIG.timezone;
    const lo = Math.floor(ms / BUCKET_MS) * BUCKET_MS;
    let c = offsetCache.get(zone);
    if (!c || c.lo !== lo) {
      try {
        let dtf = dtfCache.get(zone);
        if (!dtf) {
          dtf = new OrigDateTimeFormat('en-US', {
            timeZone: zone, hour12: false,
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit'
          });
          dtfCache.set(zone, dtf);
        }
        const parts = {};
        for (const p of dtf.formatToParts(ms)) parts[p.type] = p.value;
        const asUTC = Date.UTC(
          +parts.year, +parts.month - 1, +parts.day,
          (+parts.hour) % 24, +parts.minute, +parts.second
        );
        c = { lo, off: Math.round((asUTC - ms) / 60000) };
      } catch (e) {
        c = { lo, off: -240 }; // Fallback EDT
      }
      offsetCache.set(zone, c);
    }
    return c.off;
  }

  function tzName(ms, tz) {
    try {
      const zone = tz || CONFIG.timezone;
      let inst = tzNameCache.get(zone);
      if (!inst) {
        inst = new OrigDateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'long' });
        tzNameCache.set(zone, inst);
      }
      const parts = inst.formatToParts(ms);
      const found = parts.find(p => p.type === 'timeZoneName');
      return found ? found.value : 'Eastern Standard Time';
    } catch (e) {
      return 'Eastern Standard Time';
    }
  }

  function gmtOffset(ms, tz) {
    const m = offsetMinutesEast(ms, tz);
    const mm = isNaN(m) ? -240 : m;
    const sign = mm >= 0 ? '+' : '-';
    const abs = Math.abs(mm);
    return sign + String(Math.floor(abs / 60)).padStart(2, '0') + String(abs % 60).padStart(2, '0');
  }

  function getTargetDate(ms) {
    if (isNaN(ms)) return new OrigDate(NaN);
    const off = offsetMinutesEast(ms, CONFIG.timezone);
    return new OrigDate(ms + (isNaN(off) ? -240 * 60000 : off * 60000));
  }

  // =========================================================================
  // ---- Language / Locale (prototype-level, no instance own properties) ----
  // =========================================================================
  const navProto = (window.Navigator && Navigator.prototype) || Object.getPrototypeOf(navigator);
  const origLangDesc = Object.getOwnPropertyDescriptor(navProto, 'language');
  const origLangsDesc = Object.getOwnPropertyDescriptor(navProto, 'languages');

  const langGet = function language() {
    if (isProtectionActive()) return CONFIG.locale;
    if (origLangDesc && origLangDesc.get) return origLangDesc.get.call(this);
    return 'en-US';
  };
  markNative(langGet, 'language', { getter: true });
  Object.defineProperty(navProto, 'language', { get: langGet, configurable: true, enumerable: true });

  const langsGet = function languages() {
    if (isProtectionActive()) return languagesCache;
    if (origLangsDesc && origLangsDesc.get) return origLangsDesc.get.call(this);
    return languagesCache;
  };
  markNative(langsGet, 'languages', { getter: true });
  Object.defineProperty(navProto, 'languages', { get: langsGet, configurable: true, enumerable: true });

  // =========================================================================
  // ---- Intl constructors (default locale + default timeZone) ----
  // Statics are inherited via setPrototypeOf (no bound-function artifacts),
  // .name/.length match the native constructors, and prototype.constructor
  // points back to the patched class.
  // =========================================================================
  const INTL_NAMES = [
    'DateTimeFormat', 'NumberFormat', 'Collator', 'PluralRules', 'RelativeTimeFormat',
    'ListFormat', 'Segmenter', 'DisplayNames', 'DurationFormat'
  ];
  function patchIntlConstructor(name) {
    const Orig = window.Intl ? Intl[name] : null;
    if (typeof Orig !== 'function') return;
    const Patched = function (locales, options) {
      if (isProtectionActive()) {
        if (locales === undefined) locales = [CONFIG.locale];
        if (name === 'DateTimeFormat') {
          options = Object.assign({}, options);
          if (options.timeZone === undefined) options.timeZone = CONFIG.timezone;
        }
      }
      return Reflect.construct(Orig, [locales, options], new.target || Orig);
    };
    Patched.prototype = Orig.prototype;
    Object.setPrototypeOf(Patched, Orig);
    try {
      Object.defineProperty(Orig.prototype, 'constructor', {
        value: Patched, writable: true, configurable: true, enumerable: false
      });
    } catch (e) {}
    markNative(Patched, name, { length: 0 });
    Intl[name] = Patched;
  }
  INTL_NAMES.forEach(patchIntlConstructor);

  // =========================================================================
  // ---- Date: offset, getters, toString family, parse & constructor ----
  // =========================================================================
  const origGTO = Date.prototype.getTimezoneOffset;
  const patchedGTO = function getTimezoneOffset() {
    const origVal = origGTO.call(this); // natively throws "this is not a Date object." if invalid receiver
    if (!isProtectionActive()) return origVal;
    const t = this.getTime();
    if (isNaN(t)) return NaN; // native returns NaN for Invalid Date
    const off = offsetMinutesEast(t, CONFIG.timezone);
    return -(isNaN(off) ? -240 : off);
  };
  markNative(patchedGTO, 'getTimezoneOffset', { length: origGTO.length });
  Date.prototype.getTimezoneOffset = patchedGTO;

  // Local-component getters shift into the spoofed timezone
  const DATE_GETTERS = [
    ['getHours', 'getUTCHours'], ['getMinutes', 'getUTCMinutes'], ['getSeconds', 'getUTCSeconds'],
    ['getDate', 'getUTCDate'], ['getDay', 'getUTCDay'], ['getMonth', 'getUTCMonth'],
    ['getFullYear', 'getUTCFullYear']
  ];
  for (const [name, utcName] of DATE_GETTERS) {
    const orig = Date.prototype[name];
    const fn = function () {
      const origVal = orig.call(this); // validates receiver type natively
      if (!isProtectionActive()) return origVal;
      return getTargetDate(this.getTime())[utcName]();
    };
    markNative(fn, name, { length: orig.length });
    Date.prototype[name] = fn;
  }

  const origGetYear = Date.prototype.getYear;
  const patchedGetYear = function getYear() {
    const origVal = origGetYear.call(this);
    if (!isProtectionActive()) return origVal;
    return this.getFullYear() - 1900;
  };
  markNative(patchedGetYear, 'getYear', { length: origGetYear.length });
  Date.prototype.getYear = patchedGetYear;

  const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const origToDateString = Date.prototype.toDateString;
  const patchedToDateString = function toDateString() {
    const origVal = origToDateString.call(this);
    if (!isProtectionActive() || isNaN(this.getTime())) return origVal;
    const d = getTargetDate(this.getTime());
    return `${DAYS[d.getUTCDay()]} ${MO[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2, '0')} ${d.getUTCFullYear()}`;
  };
  markNative(patchedToDateString, 'toDateString', { length: origToDateString.length });
  Date.prototype.toDateString = patchedToDateString;

  const origToTimeString = Date.prototype.toTimeString;
  const patchedToTimeString = function toTimeString() {
    const origVal = origToTimeString.call(this);
    if (!isProtectionActive() || isNaN(this.getTime())) return origVal;
    const t = this.getTime();
    const d = getTargetDate(t);
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const mm = String(d.getUTCMinutes()).padStart(2, '0');
    const ss = String(d.getUTCSeconds()).padStart(2, '0');
    return `${hh}:${mm}:${ss} GMT${gmtOffset(t, CONFIG.timezone)} (${tzName(t, CONFIG.timezone)})`;
  };
  markNative(patchedToTimeString, 'toTimeString', { length: origToTimeString.length });
  Date.prototype.toTimeString = patchedToTimeString;

  const origToStringDate = Date.prototype.toString;
  const patchedToString = function toString() {
    const origVal = origToStringDate.call(this);
    if (!isProtectionActive() || isNaN(this.getTime())) return origVal; // "Invalid Date"
    try {
      const t = this.getTime();
      const d = getTargetDate(t);
      const hh = String(d.getUTCHours()).padStart(2, '0');
      const mm = String(d.getUTCMinutes()).padStart(2, '0');
      const ss = String(d.getUTCSeconds()).padStart(2, '0');
      return `${DAYS[d.getUTCDay()]} ${MO[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2, '0')} ${d.getUTCFullYear()} ${hh}:${mm}:${ss} GMT${gmtOffset(t, CONFIG.timezone)} (${tzName(t, CONFIG.timezone)})`;
    } catch (e) {
      return origVal;
    }
  };
  markNative(patchedToString, 'toString', { length: origToStringDate.length });
  Date.prototype.toString = patchedToString;

  // toLocale* family
  const DATE_OPTS = { year: 'numeric', month: 'numeric', day: 'numeric' };
  const TIME_OPTS = { hour: 'numeric', minute: 'numeric', second: 'numeric' };
  function patchDateMethod(name, defaultOpts) {
    const origFn = Date.prototype[name];
    const fn = function (l, o) {
      const origVal = origFn.call(this, l, o);
      if (!isProtectionActive()) return origVal;
      try {
        const locale = l === undefined ? CONFIG.locale : l;
        return new OrigDateTimeFormat(locale, Object.assign({ timeZone: CONFIG.timezone }, defaultOpts, o)).format(this);
      } catch (e) {
        return origVal; // Invalid Date -> "Invalid Date" via native
      }
    };
    markNative(fn, name, { length: origFn.length });
    Date.prototype[name] = fn;
  }
  patchDateMethod('toLocaleString', { ...DATE_OPTS, ...TIME_OPTS });
  patchDateMethod('toLocaleDateString', DATE_OPTS);
  patchDateMethod('toLocaleTimeString', TIME_OPTS);

  // ---- Date.parse & single-string constructor: strings without an explicit
  // zone are parsed by V8 in the REAL local timezone. Re-interpret that
  // wall-clock time in the spoofed timezone so the instant stays consistent.
  const PURE_NUM_RE = /^\s*-?\d+(\.\d+)?\s*$/;
  const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/; // date-only ISO parses as UTC per spec
  const HAS_ZONE_RE = /(\b(?:GMT|UTC|UT)\b)|[zZ]$|[+-]\d{2}:?\d{2}/;

  function shiftParsed(ms, s) {
    try {
      if (!isProtectionActive() || isNaN(ms) || typeof s !== 'string') return ms;
      const t = s.trim();
      if (!t || PURE_NUM_RE.test(t) || DATE_ONLY_RE.test(t) || HAS_ZONE_RE.test(t)) return ms;
      const realOffWest = origGTO.call(new OrigDate(ms)); // real system offset at that instant
      if (isNaN(realOffWest)) return ms;
      // getTimezoneOffset is minutes WEST; wall-clock value = UTC + east offset = ms - realOffWest*60000
      const wall = ms - realOffWest * 60000;
      const spoofEast = offsetMinutesEast(wall, CONFIG.timezone);
      if (isNaN(spoofEast)) return ms;
      return wall - spoofEast * 60000;
    } catch (e) {
      return ms;
    }
  }

  // ---- Date constructor ----
  function PatchedDate(...args) {
    if (!new.target) {
      return String(new PatchedDate()); // legacy callable Date() returns a string
    }
    if (args.length === 0) {
      return Reflect.construct(OrigDate, [], new.target);
    }
    if (args.length === 1) {
      const a = args[0];
      if (typeof a === 'string') {
        return Reflect.construct(OrigDate, [shiftParsed(OrigDate.parse(a), a)], new.target);
      }
      return Reflect.construct(OrigDate, [a], new.target);
    }
    // 2+ args: interpret as wall-clock in CONFIG.timezone
    if (isProtectionActive()) {
      const [y, m, d = 1, h = 0, min = 0, s = 0, ms = 0] = args;
      const nominalUTC = OrigDate.UTC(y, m, d, h, min, s, ms);
      const off = offsetMinutesEast(nominalUTC, CONFIG.timezone);
      if (!isNaN(nominalUTC) && !isNaN(off)) {
        return Reflect.construct(OrigDate, [nominalUTC - off * 60000], new.target);
      }
    }
    return Reflect.construct(OrigDate, args, new.target);
  }
  PatchedDate.prototype = OrigDate.prototype;
  Object.setPrototypeOf(PatchedDate, OrigDate); // now/UTC inherited natively (no bound fns)
  const parseFn = function parse(f) {
    return shiftParsed(OrigDate.parse(f), typeof f === 'string' ? f : String(f));
  };
  try {
    Object.defineProperty(parseFn, 'name', { value: 'parse', configurable: true });
    Object.defineProperty(parseFn, 'length', { value: 1, configurable: true });
  } catch (e) {}
  PatchedDate.parse = parseFn;
  try {
    Object.defineProperty(OrigDate.prototype, 'constructor', {
      value: PatchedDate, writable: true, configurable: true, enumerable: false
    });
  } catch (e) {}
  markNative(PatchedDate, 'Date', { length: OrigDate.length }); // native length 7
  window.Date = PatchedDate;

  // =========================================================================
  // ---- Default-locale APIs (real OS locale leak vectors) ----
  // =========================================================================
  const origNumTLS = Number.prototype.toLocaleString;
  const numTLS = function toLocaleString(locales, options) {
    if (!isProtectionActive() || locales !== undefined) return origNumTLS.call(this, locales, options);
    try { return new Intl.NumberFormat(CONFIG.locale, options).format(this.valueOf()); } catch (e) {
      return origNumTLS.call(this, locales, options);
    }
  };
  markNative(numTLS, 'toLocaleString', { length: origNumTLS.length });
  Number.prototype.toLocaleString = numTLS;

  if (typeof BigInt === 'function' && BigInt.prototype) {
    const origBigIntTLS = BigInt.prototype.toLocaleString;
    const bigTLS = function toLocaleString(locales, options) {
      if (!isProtectionActive() || locales !== undefined) return origBigIntTLS.call(this, locales, options);
      try { return new Intl.NumberFormat(CONFIG.locale, options).format(this.valueOf()); } catch (e) {
        return origBigIntTLS.call(this, locales, options);
      }
    };
    markNative(bigTLS, 'toLocaleString', { length: origBigIntTLS.length });
    BigInt.prototype.toLocaleString = bigTLS;
  }

  const origLocaleCompare = String.prototype.localeCompare;
  const patchedLocaleCompare = function localeCompare(compareString, locales, options) {
    if (!isProtectionActive() || locales !== undefined) return origLocaleCompare.call(this, compareString, locales, options);
    try { return new Intl.Collator(CONFIG.locale, options).compare(String(this), String(compareString)); } catch (e) {
      return origLocaleCompare.call(this, compareString, locales, options);
    }
  };
  markNative(patchedLocaleCompare, 'localeCompare', { length: origLocaleCompare.length });
  String.prototype.localeCompare = patchedLocaleCompare;

  // =========================================================================
  // ---- WebRTC Protection (prototype-level; no per-instance own props) ----
  // =========================================================================
  const OrigPeerConnection = window.RTCPeerConnection || window.webkitRTCPeerConnection;
  if (OrigPeerConnection && OrigPeerConnection.prototype) {
    const pcProto = OrigPeerConnection.prototype;

    function cleanSdp(sdp) {
      if (!sdp || !isProtectionActive() || !CONFIG.webrtcProtect) return sdp;
      return sdp
        .split('\r\n')
        .filter(line => line.indexOf('a=candidate:') !== 0)
        .join('\r\n');
    }

    // Constructor: attach one internal icecandidate listener BEFORE any page
    // listener can be registered. stopImmediatePropagation() on candidate
    // events suppresses every later listener (and the onicecandidate
    // handler), so no wrapping of onicecandidate/addEventListener is needed
    // and there is nothing for the page to bypass at prototype level.
    function internalIceFilter(e) {
      if (isProtectionActive() && CONFIG.webrtcProtect && e && e.candidate) {
        try { e.stopImmediatePropagation(); } catch (err) {}
      }
    }

    function PatchedRTCPeerConnection() {
      if (!new.target) {
        throw new TypeError("Failed to construct 'RTCPeerConnection': Please use the 'new' operator");
      }
      const pc = Reflect.construct(OrigPeerConnection, arguments, new.target === PatchedRTCPeerConnection ? OrigPeerConnection : new.target);
      try { pc.addEventListener('icecandidate', internalIceFilter); } catch (e) {}
      return pc;
    }
    PatchedRTCPeerConnection.prototype = OrigPeerConnection.prototype;
    Object.setPrototypeOf(PatchedRTCPeerConnection, OrigPeerConnection);
    try {
      Object.defineProperty(OrigPeerConnection.prototype, 'constructor', {
        value: PatchedRTCPeerConnection, writable: true, configurable: true, enumerable: false
      });
    } catch (e) {}
    markNative(PatchedRTCPeerConnection, 'RTCPeerConnection', { length: OrigPeerConnection.length });
    window.RTCPeerConnection = PatchedRTCPeerConnection;
    if (window.webkitRTCPeerConnection) {
      window.webkitRTCPeerConnection = PatchedRTCPeerConnection;
    }

    // createOffer / createAnswer: strip candidates from produced SDP
    const origCreateOffer = pcProto.createOffer;
    if (origCreateOffer) {
      pcProto.createOffer = function createOffer() {
        const res = origCreateOffer.apply(this, arguments);
        if (res && typeof res.then === 'function') {
          return res.then((desc) => {
            if (desc && desc.sdp) { try { desc.sdp = cleanSdp(desc.sdp); } catch (e) {} }
            return desc;
          });
        }
        return res;
      };
      markNative(pcProto.createOffer, 'createOffer', { length: origCreateOffer.length });
    }

    if (pcProto.createAnswer) {
      const origCreateAnswer = pcProto.createAnswer;
      pcProto.createAnswer = function createAnswer() {
        const res = origCreateAnswer.apply(this, arguments);
        if (res && typeof res.then === 'function') {
          return res.then((desc) => {
            if (desc && desc.sdp) { try { desc.sdp = cleanSdp(desc.sdp); } catch (e) {} }
            return desc;
          });
        }
        return res;
      };
      markNative(pcProto.createAnswer, 'createAnswer', { length: origCreateAnswer.length });
    }

    // All local description getters (incl. current/pending) cleaned at
    // prototype level, so descriptor-getter bypasses return clean SDP too.
    for (const prop of ['localDescription', 'currentLocalDescription', 'pendingLocalDescription']) {
      const desc = Object.getOwnPropertyDescriptor(pcProto, prop);
      if (desc && desc.get) {
        const origGet = desc.get;
        const patchedGet = function () {
          const d = origGet.call(this);
          if (d && d.sdp && isProtectionActive() && CONFIG.webrtcProtect) {
            try {
              if (typeof RTCSessionDescription === 'function') {
                return new RTCSessionDescription({ type: d.type, sdp: cleanSdp(d.sdp) });
              }
              return Object.assign({}, d, { sdp: cleanSdp(d.sdp) });
            } catch (e) {
              return d;
            }
          }
          return d;
        };
        markNative(patchedGet, prop, { getter: true });
        Object.defineProperty(pcProto, prop, {
          get: patchedGet,
          configurable: desc.configurable !== false,
          enumerable: !!desc.enumerable
        });
      }
    }

    // getStats: sanitize local-candidate reports IN PLACE and return the
    // original RTCStatsReport (keeps instanceof / get / iteration working).
    function sanitizeReport(r) {
      if (!r || r.type !== 'local-candidate') return;
      try {
        if (r.ip !== undefined) r.ip = '0.0.0.0';
        if (r.address !== undefined) r.address = '0.0.0.0';
        if (r.relatedAddress !== undefined && r.relatedAddress !== null) r.relatedAddress = '0.0.0.0';
        if (r.port !== undefined) r.port = 0;
        if (r.relatedPort !== undefined) r.relatedPort = 0;
      } catch (e) {}
    }

    const origGetStats = pcProto.getStats;
    if (origGetStats) {
      pcProto.getStats = function getStats() {
        const res = origGetStats.apply(this, arguments);
        if (!res || typeof res.then !== 'function') return res;
        return res.then((stats) => {
          if (stats && isProtectionActive() && CONFIG.webrtcProtect) {
            try { stats.forEach(sanitizeReport); } catch (e) {}
          }
          return stats;
        });
      };
      markNative(pcProto.getStats, 'getStats', { length: origGetStats.length });
    }
  }

  // =========================================================================
  // ---- Geolocation Protection (prototype-level, native-shaped objects) ----
  // =========================================================================
  if (typeof Geolocation !== 'undefined' && Geolocation.prototype) {
    const geoProto = Geolocation.prototype;
    const origGCP = geoProto.getCurrentPosition;
    const origWP = geoProto.watchPosition;
    const origCW = geoProto.clearWatch;

    // Values live on an intermediate prototype as accessors, so the fake
    // instances have NO own properties (like the native ones).
    function makeCoords(lat, lon, accuracy) {
      const CoordsProto = Object.create(
        (typeof GeolocationCoordinates !== 'undefined' && GeolocationCoordinates.prototype) || Object.prototype
      );
      const defs = {
        latitude: lat, longitude: lon, altitude: null,
        accuracy: accuracy, altitudeAccuracy: null, heading: null, speed: null
      };
      for (const key of Object.keys(defs)) {
        const val = defs[key];
        const getter = function () { return val; };
        markNative(getter, key, { getter: true });
        Object.defineProperty(CoordsProto, key, {
          get: getter, enumerable: true, configurable: true
        });
      }
      return Object.create(CoordsProto);
    }

    function createFakePosition(options) {
      const highAcc = !!(options && options.enableHighAccuracy);
      const latJitter = (Math.random() - 0.5) * 0.0003;
      const lonJitter = (Math.random() - 0.5) * 0.0003;
      const lat = (typeof CONFIG.latitude === 'number' ? CONFIG.latitude : 42.8864) + latJitter;
      const lon = (typeof CONFIG.longitude === 'number' ? CONFIG.longitude : -78.8784) + lonJitter;
      const accuracy = highAcc ? 6 + Math.random() * 4 : 24 + Math.random() * 10;

      const coords = makeCoords(lat, lon, accuracy);
      const PositionProto = Object.create(
        (typeof GeolocationPosition !== 'undefined' && GeolocationPosition.prototype) || Object.prototype
      );
      const coordsGetter = function () { return coords; };
      const tsGetter = function () { return OrigDate.now(); };
      markNative(coordsGetter, 'coords', { getter: true });
      markNative(tsGetter, 'timestamp', { getter: true });
      Object.defineProperty(PositionProto, 'coords', { get: coordsGetter, enumerable: true, configurable: true });
      Object.defineProperty(PositionProto, 'timestamp', { get: tsGetter, enumerable: true, configurable: true });
      return Object.create(PositionProto);
    }

    geoProto.getCurrentPosition = function getCurrentPosition(success, error, options) {
      if (!isProtectionActive() || !CONFIG.geoProtect) return origGCP.apply(this, arguments);
      if (typeof success !== 'function') {
        throw new TypeError("Failed to execute 'getCurrentPosition' on 'Geolocation': The callback provided as parameter 1 is not a function.");
      }
      const pos = createFakePosition(options);
      setTimeout(() => { success(pos); }, 12 + Math.random() * 28);
    };
    markNative(geoProto.getCurrentPosition, 'getCurrentPosition', { length: origGCP.length });

    let watchCounter = 0;
    const activeWatches = new Map();
    geoProto.watchPosition = function watchPosition(success, error, options) {
      if (!isProtectionActive() || !CONFIG.geoProtect) return origWP.apply(this, arguments);
      if (typeof success !== 'function') {
        throw new TypeError("Failed to execute 'watchPosition' on 'Geolocation': The callback provided as parameter 1 is not a function.");
      }
      const id = ++watchCounter; // small integers like the native counter
      const tick = () => success(createFakePosition(options));
      const timer = setInterval(tick, 2500 + Math.random() * 1500);
      activeWatches.set(id, timer);
      setTimeout(tick, 15 + Math.random() * 20);
      return id;
    };
    markNative(geoProto.watchPosition, 'watchPosition', { length: origWP.length });

    geoProto.clearWatch = function clearWatch(id) {
      if (activeWatches.has(id)) {
        clearInterval(activeWatches.get(id));
        activeWatches.delete(id);
        return;
      }
      return origCW.apply(this, arguments);
    };
    markNative(geoProto.clearWatch, 'clearWatch', { length: origCW.length });

    // permissions.query({name:'geolocation'}) -> 'granted', on the REAL
    // PermissionStatus instance (proper prototype / EventTarget), by marking
    // the instance in a WeakSet and spoofing the prototype's state getter.
    if (window.Permissions && Permissions.prototype && navigator.permissions) {
      const permProto = Permissions.prototype;
      const origQuery = permProto.query;
      const grantedStatuses = new WeakSet();

      if (window.PermissionStatus && PermissionStatus.prototype) {
        const stateDesc = Object.getOwnPropertyDescriptor(PermissionStatus.prototype, 'state');
        if (stateDesc && stateDesc.get) {
          const origStateGet = stateDesc.get;
          const stateGet = function state() {
            return grantedStatuses.has(this) ? 'granted' : origStateGet.call(this);
          };
          markNative(stateGet, 'state', { getter: true });
          Object.defineProperty(PermissionStatus.prototype, 'state', {
            get: stateGet, configurable: true, enumerable: true
          });
        }
      }

      permProto.query = function query(desc) {
        const res = origQuery.apply(this, arguments);
        if (res && typeof res.then === 'function') {
          return res.then((status) => {
            if (status && isProtectionActive() && CONFIG.geoProtect && desc && desc.name === 'geolocation') {
              grantedStatuses.add(status);
            }
            return status;
          });
        }
        return res;
      };
      markNative(permProto.query, 'query', { length: origQuery.length });
    }
  }

  // =========================================================================
  // ---- Canvas / OffscreenCanvas / WebGL noise (per-site seeded) ----
  // =========================================================================
  let cachedSiteSeed = 0;
  function hashStr(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
  function siteSeed() {
    if (cachedSiteSeed) return cachedSiteSeed;
    let host = '';
    try { host = location.hostname || ''; } catch (e) {}
    cachedSiteSeed = hashStr((SALT || '') + '|' + host) || 1;
    return cachedSiteSeed;
  }

  // Deterministic subtle noise: same seed + same pixels -> same output, so
  // getImageData / toDataURL / toBlob stay mutually consistent, but the
  // fingerprint differs per site (SALT is per-install, never sent clear).
  function applyNoise(imageData) {
    const data = imageData.data;
    const len = data.length;
    if (len < 16) return imageData;
    let s = siteSeed();
    const step = 4 * 17;
    for (let i = 0; i < len; i += step) {
      s ^= s << 13; s ^= s >>> 17; s ^= s << 5; s >>>= 0; // xorshift32
      const delta = (s & 3) === 0 ? -1 : (s & 3) === 1 ? 1 : 0;
      if (!delta) continue;
      data[i] = Math.max(0, Math.min(255, data[i] + delta));
      if (i + 1 < len && (s & 4)) {
        data[i + 1] = Math.max(0, Math.min(255, data[i + 1] - delta));
      }
    }
    return imageData;
  }

  (() => {
    // 1. CanvasRenderingContext2D.getImageData
    const C2D = window.CanvasRenderingContext2D && CanvasRenderingContext2D.prototype;
    if (C2D && C2D.getImageData) {
      const origGetImageData = C2D.getImageData;
      C2D.getImageData = function getImageData() {
        const imgData = origGetImageData.apply(this, arguments);
        if (isProtectionActive() && CONFIG.canvasProtect) return applyNoise(imgData);
        return imgData;
      };
      markNative(C2D.getImageData, 'getImageData', { length: origGetImageData.length });
    }

    // 2. OffscreenCanvasRenderingContext2D.getImageData (main world)
    const OC2D = window.OffscreenCanvasRenderingContext2D && OffscreenCanvasRenderingContext2D.prototype;
    if (OC2D && OC2D.getImageData) {
      const origGetImageData = OC2D.getImageData;
      OC2D.getImageData = function getImageData() {
        const imgData = origGetImageData.apply(this, arguments);
        if (isProtectionActive() && CONFIG.canvasProtect) return applyNoise(imgData);
        return imgData;
      };
      markNative(OC2D.getImageData, 'getImageData', { length: origGetImageData.length });
    }

    // Clone a canvas with noise applied to its pixels (source untouched),
    // used by toDataURL / toBlob / convertToBlob so encoded outputs are
    // noised consistently with getImageData.
    function noisyCopy(source) {
      const w = source.width;
      const h = source.height;
      if (!w || !h) return null;
      let clone;
      if (typeof OffscreenCanvas === 'function' && source instanceof OffscreenCanvas) {
        clone = new OffscreenCanvas(w, h);
      } else {
        clone = document.createElement('canvas');
        clone.width = w;
        clone.height = h;
      }
      const ctx = clone.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(source, 0, 0);
      const img = ctx.getImageData(0, 0, w, h); // patched getter applies the noise
      ctx.putImageData(img, 0, 0);
      return clone;
    }

    function withNoisyClone(origFn) {
      return function () {
        if (!isProtectionActive() || !CONFIG.canvasProtect) return origFn.apply(this, arguments);
        try {
          const clone = noisyCopy(this);
          if (clone) return origFn.apply(clone, arguments);
        } catch (e) {}
        return origFn.apply(this, arguments); // tainted canvas etc: native error path
      };
    }

    // 3. HTMLCanvasElement.toDataURL / toBlob
    const HCP = window.HTMLCanvasElement && HTMLCanvasElement.prototype;
    if (HCP && HCP.toDataURL) {
      const origToDataURL = HCP.toDataURL;
      HCP.toDataURL = withNoisyClone(origToDataURL);
      markNative(HCP.toDataURL, 'toDataURL', { length: origToDataURL.length });
    }
    if (HCP && HCP.toBlob) {
      const origToBlob = HCP.toBlob;
      HCP.toBlob = withNoisyClone(origToBlob);
      markNative(HCP.toBlob, 'toBlob', { length: origToBlob.length });
    }

    // 4. OffscreenCanvas.convertToBlob
    const OCP = window.OffscreenCanvas && OffscreenCanvas.prototype;
    if (OCP && OCP.convertToBlob) {
      const origConvertToBlob = OCP.convertToBlob;
      OCP.convertToBlob = withNoisyClone(origConvertToBlob);
      markNative(OCP.convertToBlob, 'convertToBlob', { length: origConvertToBlob.length });
    }

    // 5. WebGL / WebGL2 readPixels (deterministic per-site LSB perturbation)
    for (const GL of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
      if (!GL || !GL.prototype || !GL.prototype.readPixels) continue;
      const origReadPixels = GL.prototype.readPixels;
      GL.prototype.readPixels = function readPixels() {
        const res = origReadPixels.apply(this, arguments);
        try {
          const pixels = arguments[6];
          if (isProtectionActive() && CONFIG.canvasProtect && pixels && ArrayBuffer.isView(pixels) && pixels.length > 32) {
            let s = siteSeed();
            for (let i = 0; i < pixels.length; i += 97) {
              s ^= s << 13; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
              if ((s & 7) === 0) pixels[i] ^= 1;
            }
          }
        } catch (e) {}
        return res;
      };
      markNative(GL.prototype.readPixels, 'readPixels', { length: origReadPixels.length });
    }
  })();

  // =========================================================================
  // ---- Safe Same-Origin about:blank Iframe Synchronization ----
  // Defends against Cloudflare/Kasada creating a temporary hidden iframe
  // and reading its unhooked Date/Intl prototypes to detect tampering.
  // Strictly isolates cross-origin and sandboxed iframes to prevent SecurityErrors.
  // =========================================================================
  if (typeof HTMLIFrameElement !== 'undefined') {
    const origContentWindowDesc = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow');
    if (origContentWindowDesc && origContentWindowDesc.get) {
      const origGet = origContentWindowDesc.get;
      const patchedGet = function contentWindow() {
        const win = origGet.call(this);
        if (!win || !isProtectionActive()) return win;
        try {
          // If sandboxed without allow-scripts permission, skip
          if (this.sandbox && this.sandbox.length > 0 && !this.sandbox.contains('allow-scripts')) {
            return win;
          }
          // Only sync same-origin about:blank or empty iframes
          if (win.location && (win.location.href === 'about:blank' || win.location.href === '')) {
            if (!win[FLAG]) {
              try {
                win.Date = window.Date;
                win.Intl = window.Intl;
                if (win.navigator) {
                  try {
                    Object.defineProperty(win.navigator, 'language', { get: () => CONFIG.locale, configurable: true });
                    Object.defineProperty(win.navigator, 'languages', { get: () => languagesCache, configurable: true });
                  } catch (e) {}
                }
                win[FLAG] = 1;
              } catch (e) {}
            }
          }
        } catch (e) {
          // In cross-origin iframes, accessing win.location throws a SecurityError.
          // Caught safely here to return original win without leaking any exception.
        }
        return win;
      };
      markNative(patchedGet, 'contentWindow', { getter: true });
      Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
        get: patchedGet,
        configurable: true,
        enumerable: true
      });
    }
  }

  // =========================================================================
  // ---- Authenticated config updates ----
  // =========================================================================
  window.addEventListener(EV_NAME, (e) => {
    const d = e.detail;
    if (!CHANNEL_KEY || !d || typeof d !== 'object') return;
    const macInput = JSON.stringify({ cfg: d.cfg || null, saltEnc: d.saltEnc || null });
    if (typeof d.mac !== 'string' || d.mac !== mac(CHANNEL_KEY, macInput)) return;
    if (typeof d.saltEnc === 'string' && d.saltEnc) {
      const next = xorStream(CHANNEL_KEY, d.saltEnc);
      if (next !== SALT) {
        SALT = next;
        cachedSiteSeed = 0; // re-derive canvas noise seed
      }
    }
    if (d.cfg && typeof d.cfg === 'object') {
      const cfg = Object.assign({}, d.cfg);
      delete cfg.salt; // never accept salt through the plaintext channel
      applyConfig(cfg);
    }
  });
})();
