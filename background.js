// Service worker: captura con chrome.debugger y empuja el estado al panel flotante (content.js).
// Sigue a la pestaña activa, y cada navegación crea una "página" nueva en el historial.

const sleep = ms => new Promise(r => setTimeout(r, ms));

const OBSERVER = `(() => {
  if (window.__perf) return;
  const p = window.__perf = { fcp: 0, lcp: 0, shifts: [], tasks: [] };
  const obs = (type, fn) => { try { new PerformanceObserver(l => l.getEntries().forEach(fn)).observe({ type, buffered: true }); } catch (e) {} };
  obs('paint', e => { if (e.name === 'first-contentful-paint') p.fcp = e.startTime; });
  obs('largest-contentful-paint', e => { p.lcp = e.startTime; });
  obs('layout-shift', e => { if (!e.hadRecentInput) p.shifts.push([e.startTime, e.value]); });
  obs('longtask', e => { p.tasks.push([e.startTime, e.duration]); });
})();`;

const COLLECT = `JSON.stringify((() => {
  const n = performance.getEntriesByType('navigation')[0] || {};
  return { perf: window.__perf || null, o: performance.timeOrigin, title: document.title, url: location.href,
    nav: { ttfb: n.responseStart, dcl: n.domContentLoadedEventEnd, load: n.loadEventEnd },
    nodes: document.getElementsByTagName('*').length };
})())`;

const BACKFILL = `JSON.stringify((() => {
  const n = performance.getEntriesByType('navigation')[0] || {};
  return { o: performance.timeOrigin, url: location.href, title: document.title,
    doc: { t: n.transferSize || 0, s: n.decodedBodySize || 0, en: n.responseEnd || 0, status: n.responseStatus || 200 },
    res: performance.getEntriesByType('resource').map(e => ({ u: e.name, it: e.initiatorType, t: e.transferSize, s: e.decodedBodySize, st: e.startTime, en: e.responseEnd })) };
})())`;

const PROFILES = {
  mobile: { cpu: 4, net: { offline: false, latency: 150, downloadThroughput: 180000, uploadThroughput: 84000 } },
  desktop: { cpu: 1, net: null }
};
const NO_NET = { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 };

// Curvas de scoring de Lighthouse (p10, mediana). Sin Speed Index -> pesos renormalizados.
const CURVES = {
  mobile:  { fcp: [1800, 3000], lcp: [2500, 4000], tbt: [200, 600], cls: [0.1, 0.25] },
  desktop: { fcp: [934, 1600],  lcp: [1200, 2400], tbt: [150, 350], cls: [0.1, 0.25] }
};
const WEIGHTS = { fcp: 10, lcp: 25, tbt: 30, cls: 25 };
function erf(x) {
  const s = Math.sign(x); x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  return s * (1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x));
}
function lnScore(v, p10, median) {
  if (v <= 0) return 1;
  const xl = Math.log(v / median), pl = -Math.log(p10 / median);
  return Math.min(1, Math.max(0, (1 - erf(xl * 0.9061938024368232 / pl)) / 2));
}
function scoreOf(p) {
  if (!p.m.fcp) return null;
  const c = CURVES[ui.profile];
  const parts = Object.fromEntries(Object.keys(WEIGHTS).map(k => [k, lnScore(p.m[k], ...c[k])]));
  const total = Object.keys(WEIGHTS).reduce((s, k) => s + parts[k] * WEIGHTS[k], 0) / 90;
  return { total, ...parts };
}

// --- Estado ---
const pages = [];
const wants = new Map();            // tabId -> índice de página elegida (null = seguir la última)
const ui = { profile: 'desktop', noCache: false };
let running = false, run = null, status = 'Detenido.', busy = false, again = false, counter = 0;

const cur = () => pages[pages.length - 1];

function groupType(t) {
  if (['Document', 'Script', 'Stylesheet', 'Image', 'Font', 'Media'].includes(t)) return t;
  if (t === 'XHR' || t === 'Fetch') return 'Fetch/XHR';
  return 'Otros';
}
function guessGroup(url, it) {
  const p = url.split('?')[0].toLowerCase();
  if (/\.(woff2?|ttf|otf|eot)$/.test(p)) return 'Font';
  if (/\.css$/.test(p)) return 'Stylesheet';
  if (/\.m?js$/.test(p)) return 'Script';
  if (/\.(png|jpe?g|gif|webp|avif|svg|ico|bmp)$/.test(p)) return 'Image';
  if (/\.(mp4|webm|mp3|ogg|wav|m4a)$/.test(p)) return 'Media';
  if (it === 'script') return 'Script';
  if (it === 'img') return 'Image';
  if (it === 'fetch' || it === 'xmlhttprequest') return 'Fetch/XHR';
  if (it === 'link') return 'Stylesheet';
  return 'Otros';
}
function cls(shifts) { // ventanas de sesión: gap 1s, máx 5s
  let best = 0, c = 0, start = 0, last = 0;
  for (const [t, v] of shifts) {
    if (c && (t - last > 1000 || t - start > 5000)) { best = Math.max(best, c); c = 0; }
    if (!c) start = t;
    c += v; last = t;
  }
  return Math.max(best, c);
}

function newPage(url, origin, tabId, title) {
  const p = { n: ++counter, url, title: title || '', origin, tabId, reqs: new Map(),
    m: { fcp: 0, lcp: 0, tbt: 0, cls: 0, ttfb: 0, dcl: 0, load: 0, nodes: 0 } };
  pages.push(p);
  if (pages.length > 60) pages.shift();
  return p;
}
const mkReq = o => ({ type: 'Other', group: 'Otros', status: 0, transfer: 0, size: 0, cache: false, failed: false, end: null, ts0: 0, ...o });

// --- Envío al panel ---
let pushTimer = null;
function schedulePush() {
  if (pushTimer) return;
  pushTimer = setTimeout(() => { pushTimer = null; push(); }, 250);
}
function buildState(tabId) {
  const want = wants.get(tabId) ?? null;
  const idx = want === null ? pages.length - 1 : pages.findIndex(p => p.n === want);
  const sel = idx >= 0 ? pages[idx] : null;
  const detail = sel && {
    n: sel.n, url: sel.url, title: sel.title, origin: sel.origin, m: sel.m, score: scoreOf(sel),
    reqs: [...sel.reqs.values()].map(r => ({ id: r.id, url: r.url, group: r.group, status: r.status, transfer: r.transfer, size: r.size, start: r.start, end: r.end, cache: r.cache, failed: r.failed }))
  };
  return {
    type: 'state', visible: true, running, status, profile: ui.profile, noCache: ui.noCache, want, detail,
    hist: pages.map(p => ({ n: p.n, url: p.url, score: scoreOf(p)?.total ?? null, reqs: p.reqs.size, transfer: [...p.reqs.values()].reduce((s, r) => s + r.transfer, 0) }))
  };
}
function send(tabId, msg) { return chrome.tabs.sendMessage(tabId, msg).catch(() => {}); }
function push() { if (run?.tabId != null && running) send(run.tabId, buildState(run.tabId)); }

// --- Conexión con la pestaña ---
async function applyConditions() {
  if (!run?.target) return;
  const pr = PROFILES[ui.profile];
  const cmd = (m, p) => chrome.debugger.sendCommand(run.target, m, p);
  await cmd('Network.setCacheDisabled', { cacheDisabled: ui.noCache });
  await cmd('Network.emulateNetworkConditions', pr.net || NO_NET);
  await cmd('Emulation.setCPUThrottlingRate', { rate: pr.cpu });
}

async function backfillPage(tabId) {
  const { result } = await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', { expression: BACKFILL, returnByValue: true });
  const d = JSON.parse(result.value);
  const p = newPage(d.url, d.o, tabId, d.title);
  p.reqs.set('doc', mkReq({ id: 'doc', url: d.url, type: 'Document', group: 'Document', status: d.doc.status, transfer: d.doc.t, size: d.doc.s, start: 0, end: d.doc.en }));
  d.res.forEach((e, i) => p.reqs.set('b' + i, mkReq({
    id: 'b' + i, url: e.u, group: guessGroup(e.u, e.it), status: 200, transfer: e.t || 0, size: e.s || 0,
    cache: e.t === 0 && e.s > 0, start: e.st, end: e.en
  })));
}

async function attach(tab) {
  if (!/^https?:/.test(tab.url || '')) {
    run = { tabId: tab.id, target: null };
    status = 'Esta pestaña no se puede medir (solo http/https). Abrí un sitio y se engancha sola.';
    return;
  }
  const target = { tabId: tab.id };
  const cmd = (m, p) => chrome.debugger.sendCommand(target, m, p);
  await chrome.debugger.attach(target, '1.3');
  run = { tabId: tab.id, target, childFrames: new Set(), mainFrame: null, scriptId: null, timer: null };
  await cmd('Network.enable');
  await cmd('Page.enable');
  await applyConditions();
  run.scriptId = (await cmd('Page.addScriptToEvaluateOnNewDocument', { source: OBSERVER })).identifier;
  const { frameTree } = await cmd('Page.getFrameTree');
  run.mainFrame = frameTree.frame.id;
  (function walk(t) { (t.childFrames || []).forEach(c => { run.childFrames.add(c.frame.id); walk(c); }); })(frameTree);
  await cmd('Runtime.evaluate', { expression: OBSERVER });   // la página ya cargada: toma lo bufferizado
  await backfillPage(tab.id);
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] }).catch(() => {});
  run.timer = setInterval(poll, 1000);                       // además mantiene vivo el service worker
  status = 'Midiendo… navegá normalmente.';
  poll();
}

async function detachRun() {
  if (!run) return;
  const r = run; run = null;
  clearInterval(r.timer);
  if (!r.target) return;
  const cmd = (m, p) => chrome.debugger.sendCommand(r.target, m, p).catch(() => {});
  await cmd('Emulation.setCPUThrottlingRate', { rate: 1 });
  await cmd('Network.emulateNetworkConditions', NO_NET);
  await cmd('Network.setCacheDisabled', { cacheDisabled: false });
  if (r.scriptId) await cmd('Page.removeScriptToEvaluateOnNewDocument', { identifier: r.scriptId });
  await chrome.debugger.detach(r.target).catch(() => {});
  send(r.tabId, { type: 'hide' });
}

// Sigue a la pestaña activa (incluye links que abren pestaña nueva)
async function ensureAttached() {
  if (!running) return;
  if (busy) { again = true; return; }
  busy = true;
  try {
    do {
      again = false;
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (!tab) break;
      if (run && run.tabId === tab.id && (run.target || !/^https?:/.test(tab.url || ''))) continue;
      await detachRun();
      await attach(tab);
    } while (again);
  } catch (e) {
    status = 'Error: ' + e.message;
  } finally {
    busy = false;
    push();
  }
}

async function poll() {
  if (!run?.target) return;
  try {
    const { result } = await chrome.debugger.sendCommand(run.target, 'Runtime.evaluate', { expression: COLLECT, returnByValue: true });
    const d = JSON.parse(result.value);
    const p = cur();
    if (!p || p.tabId !== run.tabId || !d.perf) return;
    if (Math.abs(d.o - p.origin) > 5000) return;               // lectura de un documento anterior
    const fcp = d.perf.fcp || 0;
    p.origin = d.o; p.title = d.title; p.url = d.url;
    p.m = {
      fcp, lcp: d.perf.lcp || 0, cls: cls(d.perf.shifts || []),
      tbt: (d.perf.tasks || []).reduce((s, [st, du]) => (st + du > fcp ? s + Math.max(0, du - 50) : s), 0),
      ttfb: d.nav.ttfb || 0, dcl: d.nav.dcl || 0, load: d.nav.load || 0, nodes: d.nodes
    };
    schedulePush();
  } catch { /* navegando */ }
}

chrome.debugger.onEvent.addListener((src, method, p) => {
  if (!run || src.tabId !== run.tabId) return;
  let page = cur();
  switch (method) {
    case 'Page.frameAttached': run.childFrames.add(p.frameId); return;
    case 'Page.frameDetached': run.childFrames.delete(p.frameId); return;
    case 'Page.frameNavigated': if (!p.frame.parentId) run.mainFrame = p.frame.id; return;
    case 'Network.requestWillBeSent': {
      if (p.type === 'Document' && p.requestId === p.loaderId && !p.redirectResponse && !run.childFrames.has(p.frameId)) {
        page = newPage(p.request.url, p.wallTime * 1000, run.tabId);   // navegación nueva
      }
      if (!page) return;
      const prev = page.reqs.get(p.requestId);
      page.reqs.set(p.requestId, mkReq({
        id: p.requestId, url: p.request.url, type: p.type || 'Other', group: groupType(p.type),
        ts0: prev ? prev.ts0 : p.timestamp, start: prev ? prev.start : p.wallTime * 1000 - page.origin
      }));
      break;
    }
    case 'Network.responseReceived': {
      const r = page?.reqs.get(p.requestId); if (!r) return;
      r.status = p.response.status;
      r.cache = !!(p.response.fromDiskCache || p.response.fromServiceWorker);
      r.type = p.type || r.type; r.group = groupType(r.type);
      break;
    }
    case 'Network.requestServedFromCache': { const r = page?.reqs.get(p.requestId); if (r) r.cache = true; break; }
    case 'Network.dataReceived': {
      const r = page?.reqs.get(p.requestId); if (!r) return;
      r.size += p.dataLength; r.transfer += p.encodedDataLength;
      break;
    }
    case 'Network.loadingFinished': {
      const r = page?.reqs.get(p.requestId); if (!r) return;
      r.transfer = p.encodedDataLength;
      r.end = r.start + (p.timestamp - r.ts0) * 1000;
      break;
    }
    case 'Network.loadingFailed': {
      const r = page?.reqs.get(p.requestId); if (!r) return;
      r.failed = true; r.end = r.start + (p.timestamp - r.ts0) * 1000;
      break;
    }
    default: return;
  }
  schedulePush();
});

chrome.debugger.onDetach.addListener((src, reason) => {
  if (!run || src.tabId !== run.tabId) return;
  clearInterval(run.timer);
  run = null;
  if (reason === 'canceled_by_user') { running = false; status = 'Detenido (cancelaste la depuración).'; }
  else status = 'Pestaña desconectada (' + reason + ').';
  ensureAttached();
});

chrome.tabs.onActivated.addListener(() => ensureAttached());
chrome.windows.onFocusChanged.addListener(() => ensureAttached());
chrome.tabs.onUpdated.addListener((id, info, tab) => { if (tab.active && (info.url || info.status === 'complete')) ensureAttached(); });

// --- Ícono: mostrar/ocultar el panel (y arrancar/parar) ---
async function setRunning(on) {
  running = on;
  if (on) { status = 'Iniciando…'; await ensureAttached(); }
  else { const t = run?.tabId; status = 'Detenido.'; await detachRun(); if (t != null) send(t, { ...buildState(t), running: false, visible: true }); }
}
chrome.action.onClicked.addListener(async tab => {
  if (running) { const t = run?.tabId ?? tab.id; await setRunning(false); send(t, { type: 'hide' }); }
  else await setRunning(true);
});

// --- Comandos desde el panel ---
chrome.runtime.onMessage.addListener((m, sender, reply) => {
  const tabId = sender.tab?.id;
  (async () => {
    switch (m.cmd) {
      case 'hello': return running && run?.tabId === tabId ? buildState(tabId) : { type: 'hide' };
      case 'start': await setRunning(true); break;
      case 'stop': await setRunning(false); break;
      case 'close': await setRunning(false); return { type: 'hide' };
      case 'reload': if (run?.target) await chrome.debugger.sendCommand(run.target, 'Page.reload', { ignoreCache: true }); break;
      case 'clear':
        pages.length = 0; wants.clear();
        if (run?.target) await backfillPage(run.tabId);
        break;
      case 'profile': ui.profile = m.value; await applyConditions(); break;
      case 'nocache': ui.noCache = !!m.value; await applyConditions(); break;
      case 'want': wants.set(tabId, m.n); break;
      case 'export':
        return { json: JSON.stringify(pages.map(p => ({ n: p.n, url: p.url, title: p.title, metrics: p.m, score: scoreOf(p), requests: [...p.reqs.values()] })), null, 2) };
    }
    return tabId != null ? buildState(tabId) : null;
  })().then(reply);
  return true;
});
