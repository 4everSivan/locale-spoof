// Popup script for Locale & WebRTC Consistency
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

const PRESETS = {
  buffalo: {
    location: 'Buffalo, New York',
    timezone: 'America/New_York',
    locale: 'en-US',
    lat: 42.8864,
    lon: -78.8784
  },
  new_york: {
    location: 'New York, USA',
    timezone: 'America/New_York',
    locale: 'en-US',
    lat: 40.7128,
    lon: -74.0060
  },
  los_angeles: {
    location: 'Los Angeles, USA',
    timezone: 'America/Los_Angeles',
    locale: 'en-US',
    lat: 34.0522,
    lon: -118.2437
  },
  london: {
    location: 'London, UK',
    timezone: 'Europe/London',
    locale: 'en-GB',
    lat: 51.5074,
    lon: -0.1278
  },
  tokyo: {
    location: 'Tokyo, Japan',
    timezone: 'Asia/Tokyo',
    locale: 'ja-JP',
    lat: 35.6762,
    lon: 139.6503
  },
  singapore: {
    location: 'Singapore',
    timezone: 'Asia/Singapore',
    locale: 'en-SG',
    lat: 1.3521,
    lon: 103.8198
  },
  hong_kong: {
    location: 'Hong Kong',
    timezone: 'Asia/Hong_Kong',
    locale: 'zh-HK',
    lat: 22.3193,
    lon: 114.1694
  }
};

let currentConfig = { ...DEFAULT_CONFIG };
let currentTabHostname = '';
let clockTimer = null;
let is24Hour = false;

// DOM Elements
const masterToggle = document.getElementById('masterToggle');
const statusText = document.getElementById('statusText');
const protectionBadge = document.getElementById('protectionBadge');
const statusCard = document.querySelector('.status-card');

// Site-level control elements
const siteCard = document.getElementById('siteCard');
const currentDomainEl = document.getElementById('currentDomain');
const siteStatusText = document.getElementById('siteStatusText');
const siteBadge = document.getElementById('siteBadge');
const siteToggle = document.getElementById('siteToggle');
const siteToggleWrapper = document.getElementById('siteToggleWrapper');

// Whitelist elements
const whitelistToggleBtn = document.getElementById('whitelistToggleBtn');
const whitelistArrow = document.getElementById('whitelistArrow');
const whitelistBody = document.getElementById('whitelistBody');
const whitelistCount = document.getElementById('whitelistCount');
const whitelistTags = document.getElementById('whitelistTags');
const whitelistEmpty = document.getElementById('whitelistEmpty');

const locationNameEl = document.getElementById('locationName');
const timezoneCodeEl = document.getElementById('timezoneCode');
const utcOffsetEl = document.getElementById('utcOffset');
const localClockEl = document.getElementById('localClock');
const localDateEl = document.getElementById('localDate');
const localeCodeEl = document.getElementById('localeCode');
const geoCoordsEl = document.getElementById('geoCoords');

const webrtcToggle = document.getElementById('webrtcToggle');
const geoToggle = document.getElementById('geoToggle');
const canvasToggle = document.getElementById('canvasToggle');

const presetToggleBtn = document.getElementById('presetToggleBtn');
const presetArrow = document.getElementById('presetArrow');
const presetBody = document.getElementById('presetBody');
const presetSelect = document.getElementById('presetSelect');
const customArea = document.getElementById('customArea');
const customLocation = document.getElementById('customLocation');
const customTimezone = document.getElementById('customTimezone');
const customLocale = document.getElementById('customLocale');
const customLat = document.getElementById('customLat');
const customLon = document.getElementById('customLon');
const formError = document.getElementById('formError');
const applyBtn = document.getElementById('applyBtn');
const reloadTabBtn = document.getElementById('reloadTabBtn');

function extractHostname(url) {
  if (!url) return '';
  try {
    const u = new URL(url);
    if (['http:', 'https:'].includes(u.protocol)) {
      return u.hostname.toLowerCase();
    }
  } catch (e) {}
  return '';
}

function isDomainWhitelisted(host, list) {
  if (!host || !Array.isArray(list) || list.length === 0) return false;
  const h = host.toLowerCase();
  return list.some((item) => {
    if (!item) return false;
    const d = item.toLowerCase();
    return h === d || h.endsWith('.' + d);
  });
}

function formatCoords(lat, lon) {
  if (lat === undefined || lon === undefined) return '--';
  const latDir = lat >= 0 ? 'N' : 'S';
  const lonDir = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(4)}° ${latDir}, ${Math.abs(lon).toFixed(4)}° ${lonDir}`;
}

function getUtcOffsetAndName(tz) {
  try {
    const now = new Date();
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZoneName: 'short'
    });
    const parts = {};
    for (const p of dtf.formatToParts(now)) parts[p.type] = p.value;
    const asUTC = Date.UTC(
      +parts.year,
      +parts.month - 1,
      +parts.day,
      (+parts.hour) % 24,
      +parts.minute,
      +parts.second
    );
    const offsetMin = Math.round((asUTC - now.getTime()) / 60000);
    const sign = offsetMin >= 0 ? '+' : '-';
    const absMin = Math.abs(offsetMin);
    const hours = String(Math.floor(absMin / 60)).padStart(2, '0');
    const mins = String(absMin % 60).padStart(2, '0');
    const tzShort = parts.timeZoneName || '';
    return `UTC${sign}${hours}:${mins} (${tzShort})`;
  } catch (e) {
    return 'UTC-04:00 (EDT)';
  }
}

if (localClockEl) {
  localClockEl.style.cursor = 'pointer';
  localClockEl.title = '点击切换 12/24 小时制';
  localClockEl.addEventListener('click', () => {
    is24Hour = !is24Hour;
    updateClock();
  });
}

function updateClock() {
  if (!currentConfig.timezone) return;
  try {
    const now = new Date();
    const timeStr = new Intl.DateTimeFormat('en-US', {
      timeZone: currentConfig.timezone,
      hour: is24Hour ? '2-digit' : 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: !is24Hour
    }).format(now);
    localClockEl.textContent = timeStr;

    if (localDateEl) {
      const dateStr = new Intl.DateTimeFormat('en-US', {
        timeZone: currentConfig.timezone,
        weekday: 'short',
        month: 'short',
        day: 'numeric'
      }).format(now);
      localDateEl.textContent = dateStr;
    }
  } catch (e) {
    localClockEl.textContent = '--:--:--';
  }
}

function fillCustomFields() {
  customLocation.value = currentConfig.locationName || '';
  customTimezone.value = currentConfig.timezone || '';
  customLocale.value = currentConfig.locale || 'en-US';
  customLat.value = typeof currentConfig.latitude === 'number' ? currentConfig.latitude : '';
  customLon.value = typeof currentConfig.longitude === 'number' ? currentConfig.longitude : '';
}

function setFormError(msg) {
  if (formError) {
    formError.textContent = msg || '';
    formError.style.display = msg ? 'block' : 'none';
  }
}

function isValidTimezone(tz) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch (e) {
    return false;
  }
}

function isValidLocale(locale) {
  try {
    new Intl.Locale(locale);
    return true;
  } catch (e) {
    return false;
  }
}

function renderWhitelistTags() {
  const list = Array.isArray(currentConfig.whitelist) ? currentConfig.whitelist : [];
  whitelistCount.textContent = list.length;
  whitelistTags.innerHTML = '';

  if (list.length === 0) {
    whitelistEmpty.style.display = 'block';
  } else {
    whitelistEmpty.style.display = 'none';
    list.forEach((domain) => {
      const tag = document.createElement('span');
      tag.className = 'wl-tag';
      tag.textContent = domain;

      const delBtn = document.createElement('button');
      delBtn.className = 'wl-tag-del';
      delBtn.innerHTML = '&times;';
      delBtn.title = `从白名单移出 ${domain} (恢复伪装)`;
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        removeDomainFromWhitelist(domain);
      });

      tag.appendChild(delBtn);
      whitelistTags.appendChild(tag);
    });
  }
}

function removeDomainFromWhitelist(domain) {
  const list = (currentConfig.whitelist || []).filter((d) => d.toLowerCase() !== domain.toLowerCase());
  saveConfig({ whitelist: list });
}

function renderSiteCard() {
  if (!currentTabHostname) {
    currentDomainEl.textContent = '浏览器内部页面 / 离线环境';
    siteStatusText.textContent = '不适用伪装防护';
    siteStatusText.className = 'site-status whitelisted';
    siteBadge.textContent = '不适用';
    siteBadge.className = 'badge off';
    siteToggle.checked = false;
    siteToggle.disabled = true;
    siteToggleWrapper.style.opacity = '0.4';
    return;
  }

  siteToggle.disabled = false;
  siteToggleWrapper.style.opacity = '1';
  currentDomainEl.textContent = currentTabHostname;

  const isWhitelisted = isDomainWhitelisted(currentTabHostname, currentConfig.whitelist);

  if (!currentConfig.enabled) {
    siteStatusText.textContent = '扩展全局已暂停';
    siteStatusText.className = 'site-status whitelisted';
    siteBadge.textContent = '已暂停';
    siteBadge.className = 'badge off';
    siteToggle.checked = false;
  } else if (isWhitelisted) {
    siteCard.classList.add('is-whitelisted');
    siteStatusText.textContent = '已在当前网站停用 (已加入白名单)';
    siteStatusText.className = 'site-status whitelisted';
    siteBadge.textContent = '白名单';
    siteBadge.className = 'badge off';
    siteToggle.checked = false;
  } else {
    siteCard.classList.remove('is-whitelisted');
    siteStatusText.textContent = '防护中 (已开启环境伪装)';
    siteStatusText.className = 'site-status';
    siteBadge.textContent = '已启用';
    siteBadge.className = 'badge';
    siteToggle.checked = true;
  }
}

function renderUI() {
  masterToggle.checked = currentConfig.enabled;
  webrtcToggle.checked = currentConfig.webrtcProtect;
  if (geoToggle) geoToggle.checked = currentConfig.geoProtect;
  if (canvasToggle) canvasToggle.checked = currentConfig.canvasProtect;

  renderSiteCard();
  renderWhitelistTags();

  const isCurrentSiteOff = currentTabHostname && isDomainWhitelisted(currentTabHostname, currentConfig.whitelist);

  if (currentConfig.enabled && !isCurrentSiteOff) {
    statusText.textContent = '防护中 (Active)';
    statusText.classList.remove('disabled');
    protectionBadge.textContent = '已保护';
    protectionBadge.classList.remove('off');
    statusCard.classList.remove('is-off');
  } else {
    statusText.textContent = isCurrentSiteOff ? '本站白名单已停用 (Whitelisted)' : '已暂停 (Paused)';
    statusText.classList.add('disabled');
    protectionBadge.textContent = isCurrentSiteOff ? '本站放行' : '未生效';
    protectionBadge.classList.add('off');
    statusCard.classList.add('is-off');
  }

  locationNameEl.textContent = currentConfig.locationName || 'Buffalo, New York';
  timezoneCodeEl.textContent = currentConfig.timezone || 'America/New_York';
  localeCodeEl.textContent = currentConfig.locale || 'en-US';
  utcOffsetEl.textContent = getUtcOffsetAndName(currentConfig.timezone);
  if (geoCoordsEl) {
    geoCoordsEl.textContent = formatCoords(currentConfig.latitude, currentConfig.longitude);
  }

  updateClock();
  if (clockTimer) clearInterval(clockTimer);
  clockTimer = setInterval(updateClock, 1000);

  // Sync selector value
  let matchedPreset = 'custom';
  for (const [key, val] of Object.entries(PRESETS)) {
    if (
      val.timezone === currentConfig.timezone &&
      val.location === currentConfig.locationName &&
      val.locale === currentConfig.locale &&
      val.lat === currentConfig.latitude &&
      val.lon === currentConfig.longitude
    ) {
      matchedPreset = key;
      break;
    }
  }
  presetSelect.value = matchedPreset;
  if (matchedPreset === 'custom') {
    customArea.style.display = 'block';
    fillCustomFields();
  } else {
    customArea.style.display = 'none';
  }
}

function saveConfig(newCfg) {
  currentConfig = Object.assign({}, currentConfig, newCfg);
  chrome.storage.local.set(currentConfig, () => {
    renderUI();
  });
}

// Master Toggle Switch event
masterToggle.addEventListener('change', () => {
  saveConfig({ enabled: masterToggle.checked });
});

// Current Site Toggle Switch event
siteToggle.addEventListener('change', () => {
  if (!currentTabHostname) return;
  let list = Array.isArray(currentConfig.whitelist) ? [...currentConfig.whitelist] : [];
  const normHost = currentTabHostname.replace(/^www\./i, '');

  if (!siteToggle.checked) {
    // User wants to turn OFF on this site => ADD to whitelist
    if (!isDomainWhitelisted(currentTabHostname, list)) {
      list.push(normHost);
    }
  } else {
    // User wants to turn ON on this site => REMOVE from whitelist
    list = list.filter((item) => {
      const d = item.toLowerCase();
      return !(normHost === d || currentTabHostname === d || currentTabHostname.endsWith('.' + d) || d.endsWith('.' + normHost));
    });
  }
  saveConfig({ whitelist: list });
});

// Feature toggles
webrtcToggle.addEventListener('change', () => {
  saveConfig({ webrtcProtect: webrtcToggle.checked });
});

if (geoToggle) {
  geoToggle.addEventListener('change', () => {
    saveConfig({ geoProtect: geoToggle.checked });
  });
}

if (canvasToggle) {
  canvasToggle.addEventListener('change', () => {
    saveConfig({ canvasProtect: canvasToggle.checked });
  });
}

// Collapsible whitelist area
whitelistToggleBtn.addEventListener('click', () => {
  const isHidden = whitelistBody.style.display === 'none';
  whitelistBody.style.display = isHidden ? 'flex' : 'none';
  whitelistArrow.classList.toggle('expanded', isHidden);
});

// Collapsible preset area
presetToggleBtn.addEventListener('click', () => {
  const isHidden = presetBody.style.display === 'none';
  presetBody.style.display = isHidden ? 'flex' : 'none';
  presetArrow.classList.toggle('expanded', isHidden);
});

presetSelect.addEventListener('change', () => {
  if (presetSelect.value === 'custom') {
    customArea.style.display = 'block';
    fillCustomFields();
  } else {
    customArea.style.display = 'none';
  }
});

applyBtn.addEventListener('click', () => {
  const selectedKey = presetSelect.value;
  if (selectedKey === 'custom') {
    const loc = customLocation.value.trim();
    const tz = customTimezone.value.trim();
    const locale = customLocale.value.trim();
    const lat = parseFloat(customLat.value);
    const lon = parseFloat(customLon.value);

    if (!tz) {
      setFormError('请输入有效的时区标识（如 America/New_York）');
      return;
    }
    if (!isValidTimezone(tz)) {
      setFormError(`无效的 IANA 时区：${tz}`);
      return;
    }
    if (locale && !isValidLocale(locale)) {
      setFormError(`无效的 Locale：${locale}（示例 en-US）`);
      return;
    }
    if (isNaN(lat) || lat < -90 || lat > 90) {
      setFormError('纬度必须为 -90 ~ 90 之间的数字');
      return;
    }
    if (isNaN(lon) || lon < -180 || lon > 180) {
      setFormError('经度必须为 -180 ~ 180 之间的数字');
      return;
    }
    setFormError('');
    saveConfig({
      locationName: loc || tz,
      timezone: tz,
      locale: locale || currentConfig.locale || 'en-US',
      latitude: lat,
      longitude: lon
    });
  } else {
    const preset = PRESETS[selectedKey];
    if (preset) {
      saveConfig({
        locationName: preset.location,
        timezone: preset.timezone,
        locale: preset.locale,
        latitude: preset.lat,
        longitude: preset.lon
      });
    }
  }
  // Auto collapse on applied
  presetBody.style.display = 'none';
  presetArrow.classList.remove('expanded');
});

function getActiveTab(callback) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs && tabs.length > 0) {
      callback(tabs[0]);
    } else {
      chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs2) => {
        callback(tabs2 && tabs2[0] ? tabs2[0] : null);
      });
    }
  });
}

function resolveTabUrl(tab) {
  if (!tab) return '';
  const isWebUrl = (u) => {
    if (!u) return false;
    try {
      const p = new URL(u).protocol;
      return p === 'http:' || p === 'https:';
    } catch (e) {
      return false;
    }
  };
  // Prefer web URLs: if pendingUrl is http/https, use it (e.g. navigating away from chrome://newtab)
  if (isWebUrl(tab.pendingUrl)) return tab.pendingUrl;
  if (isWebUrl(tab.url)) return tab.url;
  return tab.url || tab.pendingUrl || '';
}

// Reload active tab button
reloadTabBtn.addEventListener('click', () => {
  getActiveTab((tab) => {
    if (tab && tab.id) {
      chrome.tabs.reload(tab.id);
      window.close();
    }
  });
});

function loadConfigAndRender() {
  chrome.storage.local.get(DEFAULT_CONFIG, (stored) => {
    currentConfig = Object.assign({}, DEFAULT_CONFIG, stored);
    renderUI();
  });
}

// Initialize on popup open
document.addEventListener('DOMContentLoaded', () => {
  getActiveTab((tab) => {
    let hostname = '';
    if (tab) {
      const targetUrl = resolveTabUrl(tab);
      hostname = extractHostname(targetUrl);
    }
    if (hostname) {
      currentTabHostname = hostname;
      loadConfigAndRender();
    } else if (tab && tab.id) {
      // Secondary fallback: ask content.js if tab is already on a webpage
      try {
        chrome.tabs.sendMessage(tab.id, { type: '__GET_TAB_HOSTNAME__' }, (res) => {
          if (!chrome.runtime.lastError && res && res.hostname) {
            currentTabHostname = res.hostname.toLowerCase();
          }
          loadConfigAndRender();
        });
        return;
      } catch (e) {}
      loadConfigAndRender();
    } else {
      loadConfigAndRender();
    }
  });
});
