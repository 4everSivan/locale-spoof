// Background Service Worker for Locale & WebRTC Consistency
const DEFAULT_CONFIG = {
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

function ensureSalt() {
  chrome.storage.local.get(['salt'], (r) => {
    if (chrome.runtime.lastError || (r && r.salt)) return;
    let salt = '';
    try {
      const buf = new Uint8Array(16);
      crypto.getRandomValues(buf);
      salt = Array.from(buf, b => b.toString(16).padStart(2, '0')).join('');
    } catch (e) {
      salt = String(Date.now()) + String(Math.random());
    }
    chrome.storage.local.set({ salt });
  });
}

function isDomainWhitelisted(hostname, whitelist) {
  if (!hostname || !Array.isArray(whitelist) || whitelist.length === 0) return false;
  const host = hostname.toLowerCase();
  return whitelist.some(item => {
    const d = item.toLowerCase();
    return host === d || host.endsWith('.' + d);
  });
}

function updateTabBadge(tabId, url, cfg) {
  if (!tabId || !url) return;
  try {
    const u = new URL(url);
    if (!['http:', 'https:'].includes(u.protocol)) {
      chrome.action.setBadgeText({ text: '', tabId });
      return;
    }
    const isWhitelisted = isDomainWhitelisted(u.hostname, cfg.whitelist);
    if (!cfg.enabled || isWhitelisted) {
      chrome.action.setBadgeText({ text: 'OFF', tabId });
      chrome.action.setBadgeBackgroundColor({ color: '#6b7280', tabId });
    } else {
      chrome.action.setBadgeText({ text: 'ON', tabId });
      chrome.action.setBadgeBackgroundColor({ color: '#10b981', tabId });
    }
  } catch (e) {}
}

function updateAllBadges(cfg) {
  if (cfg.enabled) {
    chrome.action.setBadgeText({ text: 'ON' });
    chrome.action.setBadgeBackgroundColor({ color: '#10b981' });
  } else {
    chrome.action.setBadgeText({ text: 'OFF' });
    chrome.action.setBadgeBackgroundColor({ color: '#6b7280' });
  }

  // Update per-tab badges based on whitelist
  chrome.tabs.query({}, (tabs) => {
    if (chrome.runtime.lastError || !tabs) return;
    for (const tab of tabs) {
      const url = tab.url || tab.pendingUrl;
      if (tab.id && url) {
        updateTabBadge(tab.id, url, cfg);
      }
    }
  });
}

function setPolicyForAllScopes(value, onDone) {
  let pending = 2;
  const done = () => { if (--pending === 0 && onDone) onDone(); };
  const scopes = ['regular', 'incognito_persistent'];
  for (const scope of scopes) {
    try {
      chrome.privacy.network.webRTCIPHandlingPolicy.set({ value, scope }, () => {
        const err = chrome.runtime.lastError;
        if (err) console.log(`WebRTC policy (${scope}) not applied:`, err.message);
        done();
      });
    } catch (e) {
      console.error(`WebRTC policy (${scope}) error:`, e);
      done();
    }
  }
}

function clearPolicyForAllScopes(onDone) {
  let pending = 2;
  const done = () => { if (--pending === 0 && onDone) onDone(); };
  for (const scope of ['regular', 'incognito_persistent']) {
    try {
      chrome.privacy.network.webRTCIPHandlingPolicy.clear({ scope }, () => {
        done();
      });
    } catch (e) {
      done();
    }
  }
}

function syncWebRTCPolicy(enabled, webrtcProtect) {
  try {
    if (enabled && webrtcProtect) {
      chrome.storage.local.get(['webrtcPrior'], (r) => {
        if (chrome.runtime.lastError) return;
        if (r && typeof r.webrtcPrior === 'string') return;
        chrome.privacy.network.webRTCIPHandlingPolicy.get({}, (cur) => {
          if (chrome.runtime.lastError || !cur) return;
          if (cur.value !== 'disable_non_proxied_udp') {
            chrome.storage.local.set({ webrtcPrior: cur.value });
          }
        });
      });
      setPolicyForAllScopes('disable_non_proxied_udp', () => {
        console.log('WebRTC policy applied: disable_non_proxied_udp');
      });
    } else {
      chrome.storage.local.get(['webrtcPrior'], (r) => {
        const prior = (!chrome.runtime.lastError && r) ? r.webrtcPrior : null;
        if (typeof prior === 'string') {
          setPolicyForAllScopes(prior, () => {
            console.log('WebRTC policy restored to prior value:', prior);
            chrome.storage.local.remove('webrtcPrior');
          });
        } else {
          clearPolicyForAllScopes(() => {
            console.log('WebRTC policy cleared.');
          });
        }
      });
    }
  } catch (e) {
    console.error('WebRTC sync error:', e);
  }
}

function initExtension() {
  ensureSalt();
  chrome.storage.local.get(DEFAULT_CONFIG, (cfg) => {
    const fullConfig = Object.assign({}, DEFAULT_CONFIG, cfg);
    chrome.storage.local.set(fullConfig);
    updateAllBadges(fullConfig);
    syncWebRTCPolicy(fullConfig.enabled, fullConfig.webrtcProtect);
  });
}

chrome.runtime.onInstalled.addListener(() => {
  initExtension();
});

chrome.runtime.onStartup.addListener(() => {
  initExtension();
});

// React to tab activation and navigation to refresh badge state
chrome.tabs.onActivated.addListener((activeInfo) => {
  chrome.tabs.get(activeInfo.tabId, (tab) => {
    if (chrome.runtime.lastError || !tab) return;
    const url = tab.url || tab.pendingUrl;
    if (!url) return;
    chrome.storage.local.get(DEFAULT_CONFIG, (cfg) => {
      updateTabBadge(tab.id, url, cfg);
    });
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const url = changeInfo.url || (tab && (tab.url || tab.pendingUrl));
  if (url) {
    chrome.storage.local.get(DEFAULT_CONFIG, (cfg) => {
      updateTabBadge(tabId, url, cfg);
    });
  }
});

// React to settings changes in real time
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local') {
    chrome.storage.local.get(DEFAULT_CONFIG, (cfg) => {
      if (changes.enabled || changes.whitelist) {
        updateAllBadges(cfg);
      }
      if (changes.enabled || changes.webrtcProtect) {
        syncWebRTCPolicy(cfg.enabled, cfg.webrtcProtect);
      }
    });
  }
});

// Run once on service worker wake
initExtension();
