// Panel flotante (Shadow DOM) que se dibuja ENCIMA de la página sin achicarla.
// Arrastrable, redimensionable desde cualquier borde/esquina, minimizable y maximizable.
(() => {
  if (window.__mdwp) return;
  window.__mdwp = true;

  const send = m => chrome.runtime.sendMessage(m).catch(() => null);
  const bytes = n => n >= 1048576 ? (n / 1048576).toFixed(2) + ' MB' : n >= 1024 ? (n / 1024).toFixed(1) + ' KB' : Math.round(n) + ' B';
  const ms = n => n >= 1000 ? (n / 1000).toFixed(2) + ' s' : Math.round(n) + ' ms';
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const color = s => s >= 0.9 ? '#0cce6b' : s >= 0.5 ? '#ffa400' : '#ff4e42';
  const SHORT = { Document: 'HTML', Script: 'JS', Stylesheet: 'CSS', Image: 'IMG', Font: 'FONT', Media: 'MEDIA', 'Fetch/XHR': 'XHR', Otros: '···' };
  const MIN_W = 300, MIN_H = 220;

  const ui = { x: null, y: 12, w: 400, h: null, min: false, max: false, prev: null, px: null, py: null, filter: 'Todos', q: '', sort: 'recent' };
  let last = null;

  const host = document.createElement('div');
  host.style.cssText = 'all:initial;position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;display:none';
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `
<style>
  :host{all:initial}
  *{box-sizing:border-box}
  [hidden]{display:none!important}
  #panel,#pill{--bg:#ffffff;--card:#f6f7f9;--fg:#1a1a1a;--mut:#6b7280;--bd:#e2e4e8;--bar:#3b82f6;--soft:#3b82f624;--bad:#ff4e42;
    font:12.5px/1.35 system-ui,Segoe UI,sans-serif;color:var(--fg)}
  @media(prefers-color-scheme:dark){#panel,#pill{--bg:#1f2023;--card:#2a2b2f;--fg:#eee;--mut:#9ca3af;--bd:#3a3c42}}
  #panel{position:fixed;display:flex;flex-direction:column;background:var(--bg);border:1px solid var(--bd);border-radius:10px;
    box-shadow:0 10px 40px #0005;overflow:hidden}
  header{display:flex;align-items:center;gap:6px;padding:7px 8px;border-bottom:1px solid var(--bd);cursor:move;user-select:none;background:var(--card)}
  header b{font-size:13px;flex:1;white-space:nowrap}
  #dot{width:9px;height:9px;border-radius:50%;background:var(--mut);flex:none} #dot.on{background:var(--bad);animation:p 1.2s infinite}
  @keyframes p{50%{opacity:.35}}
  button,select,input{font:inherit;color:var(--fg);background:var(--bg);border:1px solid var(--bd);border-radius:6px;padding:3px 8px;cursor:pointer}
  header button{padding:2px 7px;cursor:pointer} button.pri{background:var(--bar);color:#fff;border-color:var(--bar);font-weight:600}
  input[type=text],input:not([type]){cursor:text}
  .ctl{display:flex;gap:8px;align-items:center;padding:6px 8px;border-bottom:1px solid var(--bd);flex-wrap:wrap}
  .ctl label{display:flex;gap:4px;align-items:center;color:var(--mut)}
  #status{padding:4px 8px;color:var(--mut);font-size:11.5px;border-bottom:1px solid var(--bd);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  #body{flex:1;overflow:auto;padding:8px;display:grid;gap:8px;align-content:start}
  .card{background:var(--card);border:1px solid var(--bd);border-radius:8px;padding:8px}
  h2{font-size:11px;margin:0 0 5px;color:var(--mut);text-transform:uppercase;letter-spacing:.04em}
  #hist{max-height:130px;overflow:auto}
  .h{display:grid;grid-template-columns:24px 1fr 34px 58px;gap:6px;align-items:center;padding:3px 5px;border-radius:5px;cursor:pointer}
  .h:hover{background:var(--soft)} .h.sel{background:var(--soft);outline:1px solid var(--bar)}
  .h .u{overflow:hidden;text-overflow:ellipsis;white-space:nowrap} .h small{color:var(--mut)}
  .badge{display:inline-block;min-width:28px;text-align:center;border-radius:10px;padding:1px 5px;color:#000;font-weight:700;font-size:11px;background:var(--bd)}
  .top{display:grid;grid-template-columns:74px 1fr;gap:10px;align-items:center}
  .gauge{width:70px;height:70px;border-radius:50%;display:grid;place-items:center;font-size:23px;font-weight:700}
  .gauge span{background:var(--card);width:54px;height:54px;border-radius:50%;display:grid;place-items:center}
  .tiles{display:grid;grid-template-columns:1fr 1fr;gap:5px}
  .m{border-left:3px solid var(--c);padding:0 7px;line-height:1.25}
  .m b{display:block;font-size:15px;color:var(--c)} .m small{color:var(--mut);font-size:10.5px}
  .stats{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin:8px 0}
  .stats b{display:block;font-size:13.5px} .stats small{color:var(--mut);font-size:10.5px}
  .trow{display:grid;grid-template-columns:44px 1fr 92px;gap:6px;align-items:center;margin:2px 0}
  .tbar{height:7px;background:var(--bar);border-radius:4px}
  .tools{display:flex;gap:4px;flex-wrap:wrap;margin:8px 0 4px}
  .tools button{padding:1px 7px;font-size:11.5px} .tools button.on{background:var(--bar);color:#fff;border-color:var(--bar)}
  .tools input{flex:1;min-width:80px;padding:1px 7px} .tools select{padding:1px 4px}
  .row{display:grid;grid-template-columns:1fr 38px 58px 54px;gap:6px;align-items:center;padding:3px 4px;border-bottom:1px solid var(--bd)}
  .nm{overflow:hidden;white-space:nowrap;text-overflow:ellipsis} .nm small{color:var(--mut);margin-left:6px}
  .ty{font-size:10px;color:var(--mut);text-align:center;border:1px solid var(--bd);border-radius:4px}
  .sz,.tm{text-align:right;font-variant-numeric:tabular-nums} .tm{color:var(--mut)}
  .heavy{color:var(--bad);font-weight:600} .pend{animation:p 1s infinite}
  .note,.empty{color:var(--mut);font-size:11px;padding:8px 2px}
  #pill{position:fixed;display:flex;gap:8px;align-items:center;padding:7px 12px;border-radius:20px;background:var(--bg);border:1px solid var(--bd);
    box-shadow:0 4px 18px #0004;cursor:grab;user-select:none;font-weight:600}
  .rz{position:absolute;z-index:2}
  .rz[data-d=n],.rz[data-d=s]{left:10px;right:10px;height:6px;cursor:ns-resize} .rz[data-d=n]{top:-3px} .rz[data-d=s]{bottom:-3px}
  .rz[data-d=e],.rz[data-d=w]{top:10px;bottom:10px;width:6px;cursor:ew-resize} .rz[data-d=e]{right:-3px} .rz[data-d=w]{left:-3px}
  .rz[data-d=ne],.rz[data-d=nw],.rz[data-d=se],.rz[data-d=sw]{width:14px;height:14px}
  .rz[data-d=ne]{top:-3px;right:-3px;cursor:nesw-resize} .rz[data-d=sw]{bottom:-3px;left:-3px;cursor:nesw-resize}
  .rz[data-d=nw]{top:-3px;left:-3px;cursor:nwse-resize} .rz[data-d=se]{bottom:-3px;right:-3px;cursor:nwse-resize}
</style>
<div id="panel">
  <header id="drag">
    <span id="dot"></span><b>MD Web performance</b>
    <button id="toggle" class="pri" title="Iniciar / detener">▶</button>
    <button id="reload" title="Recargar sin caché y medir">⟳</button>
    <button id="clear" title="Limpiar historial">🗑</button>
    <button id="export" title="Exportar JSON">⬇</button>
    <button id="min" title="Minimizar">—</button>
    <button id="max" title="Agrandar / restaurar">⛶</button>
    <button id="close" title="Cerrar y detener">✕</button>
  </header>
  <div class="ctl">
    <select id="profile"><option value="desktop">Escritorio</option><option value="mobile">Móvil (CPU 4x + 4G lenta)</option></select>
    <label><input type="checkbox" id="nocache"> sin caché</label>
  </div>
  <div id="status"></div>
  <div id="body">
    <section class="card"><h2>Páginas visitadas</h2><div id="hist"></div></section>
    <section class="card" id="detail"><div class="empty">Navegá y se va llenando solo.</div></section>
  </div>
  <i class="rz" data-d="n"></i><i class="rz" data-d="s"></i><i class="rz" data-d="e"></i><i class="rz" data-d="w"></i>
  <i class="rz" data-d="ne"></i><i class="rz" data-d="nw"></i><i class="rz" data-d="se"></i><i class="rz" data-d="sw"></i>
</div>
<div id="pill" hidden title="Click: abrir · Arrastrar: mover"></div>`;

  const $ = s => root.querySelector(s);
  const panel = $('#panel'), pill = $('#pill');

  // --- Geometría ---
  function save() { try { chrome.storage.local.set({ mdwp_ui: { x: ui.x, y: ui.y, w: ui.w, h: ui.h, min: ui.min, max: ui.max, prev: ui.prev, px: ui.px, py: ui.py, sort: ui.sort } }); } catch {} }
  function layout() {
    const W = innerWidth, H = innerHeight;
    if (ui.h === null) ui.h = Math.min(640, H - 24);
    if (ui.x === null) ui.x = W - ui.w - 12;
    ui.w = Math.min(Math.max(ui.w, MIN_W), W); ui.h = Math.min(Math.max(ui.h, MIN_H), H);
    ui.x = Math.min(Math.max(ui.x, 0), W - ui.w); ui.y = Math.min(Math.max(ui.y, 0), H - ui.h);
    panel.style.cssText = `left:${ui.x}px;top:${ui.y}px;width:${ui.w}px;height:${ui.h}px`;
    if (ui.px === null) { ui.px = W - 190; ui.py = H - 60; }
    ui.px = Math.min(Math.max(ui.px, 0), W - 80); ui.py = Math.min(Math.max(ui.py, 0), H - 40);
    pill.style.cssText = `left:${ui.px}px;top:${ui.py}px`;
    panel.hidden = ui.min; pill.hidden = !ui.min;
  }
  function drag(el, onMove, onClick) {
    el.addEventListener('pointerdown', e => {
      if (e.button !== 0 || e.target.closest('button,select,input')) return;
      e.preventDefault(); el.setPointerCapture(e.pointerId);
      const sx = e.clientX, sy = e.clientY, s = { ...ui }; let moved = false;
      const mv = ev => { const dx = ev.clientX - sx, dy = ev.clientY - sy; if (Math.abs(dx) + Math.abs(dy) > 3) moved = true; onMove(dx, dy, s); layout(); };
      const up = () => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); if (!moved && onClick) onClick(); save(); };
      el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up);
    });
  }
  drag($('#drag'), (dx, dy, s) => { ui.max = false; ui.x = s.x + dx; ui.y = s.y + dy; });
  drag(pill, (dx, dy, s) => { ui.px = s.px + dx; ui.py = s.py + dy; }, () => { ui.min = false; layout(); save(); });
  root.querySelectorAll('.rz').forEach(h => {
    const d = h.dataset.d;
    drag(h, (dx, dy, s) => {
      ui.max = false;
      if (d.includes('e')) ui.w = Math.max(MIN_W, s.w + dx);
      if (d.includes('s')) ui.h = Math.max(MIN_H, s.h + dy);
      if (d.includes('w')) { const w = Math.max(MIN_W, s.w - dx); ui.x = s.x + s.w - w; ui.w = w; }
      if (d.includes('n')) { const hh = Math.max(MIN_H, s.h - dy); ui.y = s.y + s.h - hh; ui.h = hh; }
    });
  });
  addEventListener('resize', layout);

  $('#min').onclick = () => { ui.min = true; layout(); save(); };
  $('#max').onclick = () => {
    if (ui.max) { Object.assign(ui, ui.prev); ui.max = false; }
    else { ui.prev = { x: ui.x, y: ui.y, w: ui.w, h: ui.h }; Object.assign(ui, { x: 16, y: 16, w: innerWidth - 32, h: innerHeight - 32 }); ui.max = true; }
    layout(); save();
  };

  // --- Comandos ---
  const run = m => send(m).then(s => s && render(s));
  $('#toggle').onclick = () => run({ cmd: last?.running ? 'stop' : 'start' });
  $('#reload').onclick = () => run({ cmd: 'reload' });
  $('#clear').onclick = () => run({ cmd: 'clear' });
  $('#close').onclick = () => run({ cmd: 'close' });
  $('#profile').onchange = e => run({ cmd: 'profile', value: e.target.value });
  $('#nocache').onchange = e => run({ cmd: 'nocache', value: e.target.checked });
  $('#export').onclick = async () => {
    const r = await send({ cmd: 'export' }); if (!r?.json) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([r.json], { type: 'application/json' }));
    a.download = 'md-web-performance-' + Date.now() + '.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  // --- Render ---
  function host_(u) { try { return new URL(u).host; } catch { return ''; } }
  function name(u) {
    if (u.startsWith('data:')) return 'data: URI';
    try { const x = new URL(u); const f = decodeURIComponent(x.pathname.split('/').filter(Boolean).pop() || x.host); return f + (x.search ? '?…' : ''); } catch { return u; }
  }

  function render(s) {
    if (!s || s.type === 'hide' || !s.visible && s.type !== 'state') { host.style.display = 'none'; return; }
    last = s;
    if (!host.isConnected) document.documentElement.appendChild(host);
    host.style.display = '';
    layout();

    $('#dot').className = s.running ? 'on' : '';
    $('#toggle').textContent = s.running ? '■' : '▶';
    $('#status').textContent = s.status; $('#status').title = s.status;
    if (root.activeElement !== $('#profile')) $('#profile').value = s.profile;
    $('#nocache').checked = s.noCache;

    const latest = s.hist.length ? s.hist[s.hist.length - 1].n : null;
    const selN = s.want ?? latest;
    $('#hist').innerHTML = s.hist.length ? [...s.hist].reverse().map(h =>
      `<div class="h ${h.n === selN ? 'sel' : ''}" data-n="${h.n}" title="${esc(h.url)}"><small>#${h.n}</small>
        <span class="u">${esc(name(h.url))} <small>${esc(host_(h.url))}</small></span>
        <span class="badge" ${h.score != null ? `style="background:${color(h.score)}"` : ''}>${h.score != null ? Math.round(h.score * 100) : '–'}</span>
        <small style="text-align:right">${bytes(h.transfer)}</small></div>`).join('')
      : '<div class="empty">Sin páginas todavía.</div>';

    const pl = s.hist.length ? s.hist[s.hist.length - 1] : null;
    pill.innerHTML = `<span style="color:${pl?.score != null ? color(pl.score) : 'inherit'}">${pl?.score != null ? Math.round(pl.score * 100) : '–'}</span><span>${pl ? bytes(pl.transfer) : ''}</span><span style="color:var(--mut)">${pl ? pl.reqs + ' req' : ''}</span>`;

    renderDetail(s);
  }

  function renderDetail(s) {
    const d = s.detail, box = $('#detail');
    if (!d) { box.innerHTML = '<div class="empty">Navegá y se va llenando solo.</div>'; return; }
    const R = d.reqs, m = d.m, sc = d.score;
    const tt = R.reduce((a, r) => a + r.transfer, 0), ts = R.reduce((a, r) => a + r.size, 0);
    const groups = {};
    R.forEach(r => { const g = groups[r.group] ||= { n: 0, t: 0 }; g.n++; g.t += r.transfer; });
    const maxG = Math.max(...Object.values(groups).map(g => g.t), 1);
    const tile = (label, val, k) => { const c = sc ? color(sc[k]) : 'var(--mut)'; return `<div class="m" style="--c:${c}"><small>${label}</small><b>${val}</b></div>`; };
    const total = sc ? sc.total : null;

    // Se reconstruye el esqueleto solo si cambia la página mostrada; así el input de búsqueda no pierde el foco.
    if (box.dataset.n !== String(d.n)) {
      box.dataset.n = d.n;
      box.innerHTML = `<div id="sum"></div>
        <div class="tools" id="chips"></div>
        <div id="list"></div>`;
    }
    $('#sum').innerHTML = `
      <div style="color:var(--mut);margin-bottom:6px;word-break:break-all">${esc(d.title || '')} <br>${esc(d.url)}</div>
      <div class="top">
        <div class="gauge" style="background:conic-gradient(${total != null ? color(total) : 'var(--bd)'} ${(total || 0) * 360}deg,var(--bd) 0)"><span style="color:${total != null ? color(total) : 'var(--mut)'}">${total != null ? Math.round(total * 100) : '–'}</span></div>
        <div class="tiles">${tile('FCP', m.fcp ? ms(m.fcp) : '…', 'fcp')}${tile('LCP', m.lcp ? ms(m.lcp) : '…', 'lcp')}${tile('TBT', ms(m.tbt), 'tbt')}${tile('CLS', m.cls.toFixed(3), 'cls')}</div>
      </div>
      <div class="stats">
        <div><b>${R.length}</b><small>requests</small></div><div><b>${bytes(tt)}</b><small>transferido</small></div>
        <div><b>${bytes(ts)}</b><small>descomprim.</small></div><div><b>${m.load ? ms(m.load) : '…'}</b><small>load</small></div>
        <div><b>${ms(m.ttfb || 0)}</b><small>TTFB</small></div><div><b>${m.dcl ? ms(m.dcl) : '…'}</b><small>DCL</small></div>
        <div><b>${m.nodes}</b><small>nodos DOM</small></div>
      </div>
      ${Object.entries(groups).sort((a, b) => b[1].t - a[1].t).map(([g, v]) =>
        `<div class="trow"><span>${SHORT[g] || g}</span><div class="tbar" style="width:${Math.max(2, v.t / maxG * 100)}%"></div><span>${bytes(v.t)} · ${v.n}</span></div>`).join('')}`;

    $('#chips').innerHTML = ['Todos', ...Object.keys(groups)].map(g => `<button data-g="${g}" class="${g === ui.filter ? 'on' : ''}">${SHORT[g] || g}</button>`).join('') +
      `<input id="q" placeholder="Filtrar URL…" value="${esc(ui.q)}"><select id="sort">
        <option value="recent">Recientes</option><option value="heavy">Más pesados</option><option value="slow">Más lentos</option></select>`;
    $('#sort').value = ui.sort;

    drawList(R);
    function drawList(all) {
      let rows = all.filter(r => (ui.filter === 'Todos' || r.group === ui.filter) && r.url.toLowerCase().includes(ui.q.toLowerCase()));
      const dur = r => (r.end ?? r.start) - r.start;
      rows.sort(ui.sort === 'heavy' ? (a, b) => b.transfer - a.transfer : ui.sort === 'slow' ? (a, b) => dur(b) - dur(a) : (a, b) => b.start - a.start);
      const max = Math.max(...rows.map(r => r.transfer), 1);
      $('#list').innerHTML = rows.slice(0, 400).map(r => {
        const pct = Math.round(r.transfer / max * 100);
        return `<div class="row" style="background:linear-gradient(90deg,var(--soft) ${pct}%,transparent ${pct}%)" title="${esc(r.url)}">
          <span class="nm">${esc(name(r.url))}<small>${esc(host_(r.url))}</small></span>
          <span class="ty">${SHORT[r.group] || r.group}</span>
          <span class="sz ${r.transfer > 102400 ? 'heavy' : ''}">${r.failed ? '❌' : r.cache && !r.transfer ? 'cache' : bytes(r.transfer)}</span>
          <span class="tm ${r.end == null ? 'pend' : ''}">${r.end == null ? '…' : ms(dur(r))}</span></div>`;
      }).join('') + (rows.length > 400 ? `<div class="note">Mostrando 400 de ${rows.length}.</div>` : '') +
        '<div class="note">Score aproximado (sin Speed Index): útil para comparar páginas entre sí, no como cifra oficial de Lighthouse.</div>';
    }
    box._draw = () => drawList(R);
  }

  // Delegación de eventos del contenido dinámico
  root.addEventListener('click', e => {
    const h = e.target.closest('.h');
    if (h && last) { const n = +h.dataset.n; const latest = last.hist[last.hist.length - 1]?.n; run({ cmd: 'want', n: n === latest ? null : n }); return; }
    const g = e.target.closest('[data-g]');
    if (g) { ui.filter = g.dataset.g; root.querySelectorAll('[data-g]').forEach(b => b.classList.toggle('on', b === g)); $('#detail')._draw?.(); }
  });
  root.addEventListener('input', e => { if (e.target.id === 'q') { ui.q = e.target.value; $('#detail')._draw?.(); } });
  root.addEventListener('change', e => { if (e.target.id === 'sort') { ui.sort = e.target.value; save(); $('#detail')._draw?.(); } });

  chrome.runtime.onMessage.addListener(m => { if (m.type === 'state' || m.type === 'hide') render(m); });

  chrome.storage.local.get('mdwp_ui').then(r => {
    if (r?.mdwp_ui) Object.assign(ui, r.mdwp_ui);
  }).catch(() => {}).finally(() => send({ cmd: 'hello' }).then(s => s && render(s)));
})();
