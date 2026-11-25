(function () {
  'use strict';

  const C = window.NCKHCore;
  if (!C) {
    document.body.innerHTML = '<p style="padding:24px;font-family:sans-serif">Không tải được core.js.</p>';
    return;
  }

  const NS = 'http://www.w3.org/2000/svg';
  const $ = (id) => document.getElementById(id);
  const FEATURES = C.FEATURES;
  const state = { records: null, result: null, source: '', sampleCsv: '', sampleLabel: '' };

  const color = (i) => C.CLUSTER_COLORS[i % C.CLUSTER_COLORS.length];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (m) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[m]));
  }
  function fmt(v, d) {
    d = d == null ? 3 : d;
    return (v == null || !Number.isFinite(v)) ? '—' : Number(v).toFixed(d);
  }
  function fmtPct(v, d) {
    d = d == null ? 2 : d;
    return (v == null || !Number.isFinite(v)) ? '—' : (v * 100).toFixed(d) + '%';
  }
  function fmtAxis(v, digits) {
    if (v == null || !Number.isFinite(v)) return '—';
    if (digits != null) {
      const r = Number(v.toFixed(digits));
      return (r === 0 ? 0 : r).toFixed(digits);
    }
    const a = Math.abs(v);
    if (a >= 100) return v.toFixed(0);
    if (a >= 1) return v.toFixed(1);
    if (a >= 0.01) return v.toFixed(2);
    return v.toFixed(4);
  }
  function digitsFor(span) {
    const a = Math.abs(span);
    if (a >= 100) return 0;
    if (a >= 10) return 1;
    if (a >= 1) return 2;
    if (a >= 0.1) return 3;
    return 4;
  }
  function svgEl(tag, attrs, text) {
    const el = document.createElementNS(NS, tag);
    if (attrs) Object.keys(attrs).forEach((k) => el.setAttribute(k, attrs[k]));
    if (text != null) el.textContent = text;
    return el;
  }
  function setStatus(msg, kind) {
    const el = $('status');
    el.className = 'status' + (kind ? ' ' + kind : '');
    el.textContent = msg;
  }
  function clusterChip(j) {
    return `<span class="chip c${j % 6}"><span class="dot" style="background:${color(j)}"></span>C${j + 1}</span>`;
  }
  function suggestionChip(s) {
    const cls = s.tone === 'acc' ? 'acc' : s.tone === 'dist' ? 'dist' : 'neutral';
    return `<span class="chip ${cls}" title="Heuristic minh họa, không phải kết luận">${esc(s.suggestion)}</span>`;
  }
  function download(name, text, type) {
    const blob = new Blob(['\uFEFF' + text], { type: type || 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 800);
  }

  function fillSelect(el, items, keep) {
    const prev = keep ? el.value : null;
    el.innerHTML = items.map((it) => `<option value="${esc(it.value)}">${esc(it.label)}</option>`).join('');
    if (prev && items.some((it) => String(it.value) === String(prev))) el.value = prev;
  }

  function init() {
    fillSelect($('scatterX'), FEATURES.map((f) => ({ value: f.key, label: f.label })), false);
    fillSelect($('scatterY'), FEATURES.map((f) => ({ value: f.key, label: f.label })), false);
    $('scatterX').value = 'clv';
    $('scatterY').value = 'drift';

    $('dropzone').addEventListener('click', () => $('fileInput').click());
    $('dropzone').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('fileInput').click(); }
    });
    ['dragenter', 'dragover'].forEach((ev) => {
      $('dropzone').addEventListener(ev, (e) => { e.preventDefault(); $('dropzone').classList.add('drag'); });
    });
    ['dragleave', 'drop'].forEach((ev) => {
      $('dropzone').addEventListener(ev, (e) => { e.preventDefault(); $('dropzone').classList.remove('drag'); });
    });
    $('dropzone').addEventListener('drop', (e) => {
      const f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) readFile(f);
    });
    $('fileInput').addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      if (f) readFile(f);
      e.target.value = '';
    });

    $('runBtn').addEventListener('click', runAnalysis);
    $('sampleBtn').addEventListener('click', loadSample);
    $('downloadSampleBtn').addEventListener('click', () => {
      download('sample_vn30.csv', ensureSample());
    });
    $('exportBtn').addEventListener('click', () => {
      if (!state.result) return;
      download('nckh_windows.csv', C.windowsToCSV(state.result));
    });
    $('tickerSelect').addEventListener('change', () => {
      if (state.result) drawPrice($('tickerSelect').value);
    });
    $('scatterX').addEventListener('change', drawScatter);
    $('scatterY').addEventListener('change', drawScatter);
    $('obsFilter').addEventListener('change', renderObservations);

    state.sampleCsv = ensureSample();
    ingest(state.sampleCsv, state.sampleLabel);
  }

  function readFile(file) {
    setStatus('Đang đọc file ' + file.name + '...', 'busy');
    const reader = new FileReader();
    reader.onload = () => ingest(String(reader.result || ''), `${file.name} · ${(file.size / 1024).toFixed(1)} KB`);
    reader.onerror = () => fail(new Error('Không đọc được file CSV.'));
    reader.readAsText(file, 'UTF-8');
  }

  function ingest(text, source) {
    try {
      const parsed = C.parseCSV(text);
      const records = C.buildRecords(parsed);
      state.records = records;
      state.source = source;
      $('fileMeta').textContent = `${source} · ${records.length.toLocaleString('vi-VN')} dòng hợp lệ`;
      $('emptyState').classList.add('hidden');
      $('results').classList.remove('hidden');
      runAnalysis();
    } catch (e) {
      fail(e);
    }
  }

  function fail(e) {
    setStatus(e && e.message ? e.message : String(e), 'err');
    if (window.console) console.error(e);
    $('runBtn').disabled = false;
  }

  function ensureSample() {
    if (!state.sampleCsv) {
      const s = C.generateSample({});
      state.sampleCsv = s.csv;
      state.sampleLabel = `Dữ liệu mô phỏng · ${s.tickers} mã × ${s.days} phiên`;
    }
    return state.sampleCsv;
  }

  function loadSample() {
    ingest(ensureSample(), state.sampleLabel);
  }

  function runAnalysis() {
    if (!state.records) return;
    const W = parseInt($('WInput').value, 10);
    const step = parseInt($('stepInput').value, 10);
    const k = $('kSelect').value;
    $('runBtn').disabled = true;
    setStatus('Đang tính biến và phân cụm...', 'busy');
    setTimeout(() => {
      try {
        const result = C.analyze(state.records, { W, step, k, source: state.source });
        state.result = result;
        render(result);
        setStatus(`Xong · ${result.meta.n.toLocaleString('vi-VN')} cửa sổ · K=${result.k} · silhouette=${result.silhouette.toFixed(3)}`, 'ok');
      } catch (e) {
        fail(e);
      } finally {
        $('runBtn').disabled = false;
      }
    }, 40);
  }

  function render(result) {
    const m = result.meta;
    $('kpiWindows').textContent = m.n.toLocaleString('vi-VN');
    $('kpiTickers').textContent = String(m.tickers.length);
    $('kpiK').textContent = String(result.k);
    $('kpiSil').textContent = result.silhouette.toFixed(3);
    $('metaLine').textContent = `W=${m.W} · bước=${m.step} · ${m.n.toLocaleString('vi-VN')} cửa sổ · mã: ${m.tickers.join(', ') || '—'} · nguồn: ${m.source}`;

    $('legend').innerHTML = result.summaries.map((s) => clusterChip(s.cluster)).join('');
    renderSummary(result);
    renderTickerSelect(result);
    drawPrice($('tickerSelect').value);
    drawScatter();
    drawForward(result);
    renderObsFilter(result);
    renderObservations();
  }

  function renderSummary(result) {
    const tbody = $('summaryBody');
    tbody.innerHTML = '';
    result.summaries.forEach((s) => {
      const tr = document.createElement('tr');
      const fwdCls = s.forward20 == null ? '' : s.forward20 >= 0 ? 'pos' : 'neg';
      tr.innerHTML = `
        <td>${clusterChip(s.cluster)}</td>
        <td class="num">${s.n.toLocaleString('vi-VN')}</td>
        <td class="num">${(s.share * 100).toFixed(1)}%</td>
        <td class="num">${fmtPct(s.means.drift, 3)}</td>
        <td class="num">${fmtPct(s.means.vol, 3)}</td>
        <td class="num">${fmt(s.means.clv, 3)}</td>
        <td class="num">${fmt(s.means.cmf, 3)}</td>
        <td class="num">${fmt(s.means.illiq, 2)}</td>
        <td class="num ${fwdCls}">${s.forward20 == null ? '—' : fmtPct(s.forward20, 2)}</td>
        <td>${suggestionChip(s)}</td>`;
      tbody.appendChild(tr);
    });
  }

  function renderTickerSelect(result) {
    const tickers = Array.from(new Set(result.windows.map((w) => w.ticker)));
    fillSelect($('tickerSelect'), tickers.map((t) => ({ value: t, label: t })), true);
  }

  function baseSvg(W, H, label) {
    return svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': label });
  }

  function drawPrice(ticker) {
    const wrap = $('priceChart');
    if (!state.result) return;
    const rows = state.result.windows.filter((w) => w.ticker === ticker);
    if (!rows.length) {
      wrap.innerHTML = '<div class="chart-empty">Không có dữ liệu cho mã này.</div>';
      return;
    }
    wrap.innerHTML = '';
    const W = 860, H = 330, m = { l: 58, r: 16, t: 14, b: 38 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    let ymin = Math.min.apply(null, rows.map((r) => r.close));
    let ymax = Math.max.apply(null, rows.map((r) => r.close));
    if (!isFinite(ymin) || !isFinite(ymax)) return;
    if (ymax - ymin < 1e-9) { ymin -= 1; ymax += 1; }
    const pad = (ymax - ymin) * 0.08;
    ymin -= pad; ymax += pad;
    const x = (i) => m.l + (rows.length <= 1 ? iw / 2 : (i * iw) / (rows.length - 1));
    const y = (v) => m.t + ih - ((v - ymin) / (ymax - ymin)) * ih;

    const svg = baseSvg(W, H, `Giá đóng cửa ${ticker} theo cửa sổ`);
    for (let t = 0; t <= 4; t++) {
      const yy = m.t + (ih * t) / 4;
      const val = ymax - ((ymax - ymin) * t) / 4;
      svg.appendChild(svgEl('line', { x1: m.l, x2: m.l + iw, y1: yy, y2: yy, stroke: '#e6ecf4', 'stroke-width': 1 }));
      svg.appendChild(svgEl('text', { x: m.l - 8, y: yy + 4, 'text-anchor': 'end', 'font-size': 10.5, fill: '#64748b' }, val.toFixed(2)));
    }
    svg.appendChild(svgEl('line', { x1: m.l, x2: m.l + iw, y1: m.t + ih, y2: m.t + ih, stroke: '#94a3b8', 'stroke-width': 1 }));

    const d = rows.map((r, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(r.close).toFixed(1)}`).join(' ');
    svg.appendChild(svgEl('path', { d, fill: 'none', stroke: '#94a3b8', 'stroke-width': 1.2, opacity: 0.85 }));

    rows.forEach((r, i) => {
      const c = svgEl('circle', { cx: x(i).toFixed(1), cy: y(r.close).toFixed(1), r: 2.8, fill: color(r.cluster), opacity: 0.92 });
      c.appendChild(svgEl('title', {}, `${r.dateLabel} · ${ticker} · close ${r.close.toFixed(2)} · C${r.cluster + 1}`));
      svg.appendChild(c);
    });

    const idxs = Array.from(new Set([0, Math.floor((rows.length - 1) / 2), rows.length - 1]));
    idxs.forEach((idx, k) => {
      svg.appendChild(svgEl('text', {
        x: x(idx), y: m.t + ih + 22,
        'text-anchor': k === 0 ? 'start' : k === idxs.length - 1 ? 'end' : 'middle',
        'font-size': 10.5, fill: '#64748b'
      }, rows[idx].dateLabel));
    });
    svg.appendChild(svgEl('text', { x: m.l, y: 10, 'font-size': 10.5, fill: '#94a3b8' }, 'Giá đóng cửa'));
    wrap.appendChild(svg);
  }

  function drawScatter() {
    const wrap = $('scatterChart');
    if (!state.result) return;
    const xKey = $('scatterX').value;
    const yKey = $('scatterY').value;
    const xf = FEATURES.find((f) => f.key === xKey);
    const yf = FEATURES.find((f) => f.key === yKey);
    const rows = state.result.windows;
    if (!rows.length || !xf || !yf) return;
    wrap.innerHTML = '';
    const W = 860, H = 360, m = { l: 62, r: 18, t: 16, b: 48 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
    rows.forEach((r) => {
      const xv = r.f[xKey], yv = r.f[yKey];
      if (!Number.isFinite(xv) || !Number.isFinite(yv)) return;
      xmin = Math.min(xmin, xv); xmax = Math.max(xmax, xv);
      ymin = Math.min(ymin, yv); ymax = Math.max(ymax, yv);
    });
    if (!isFinite(xmin) || !isFinite(ymin)) {
      wrap.innerHTML = '<div class="chart-empty">Không có điểm hợp lệ.</div>';
      return;
    }
    if (xmax - xmin < 1e-9) { xmin -= 1; xmax += 1; }
    if (ymax - ymin < 1e-9) { ymin -= 1; ymax += 1; }
    const xpad = (xmax - xmin) * 0.06, ypad = (ymax - ymin) * 0.08;
    xmin -= xpad; xmax += xpad; ymin -= ypad; ymax += ypad;
    const x = (v) => m.l + ((v - xmin) / (xmax - xmin)) * iw;
    const y = (v) => m.t + ih - ((v - ymin) / (ymax - ymin)) * ih;

    const xd = digitsFor(xmax - xmin), yd = digitsFor(ymax - ymin);
    const svg = baseSvg(W, H, `Phân bố ${xf.label} và ${yf.label} theo cụm`);
    for (let t = 0; t <= 4; t++) {
      const yy = m.t + (ih * t) / 4;
      svg.appendChild(svgEl('line', { x1: m.l, x2: m.l + iw, y1: yy, y2: yy, stroke: '#e6ecf4', 'stroke-width': 1 }));
      svg.appendChild(svgEl('text', { x: m.l - 8, y: yy + 4, 'text-anchor': 'end', 'font-size': 10.5, fill: '#64748b' }, fmtAxis(ymax - ((ymax - ymin) * t) / 4, yd)));
      const xx = m.l + (iw * t) / 4;
      svg.appendChild(svgEl('line', { x1: xx, x2: xx, y1: m.t, y2: m.t + ih, stroke: '#f1f5f9', 'stroke-width': 1 }));
      svg.appendChild(svgEl('text', { x: xx, y: m.t + ih + 20, 'text-anchor': 'middle', 'font-size': 10.5, fill: '#64748b' }, fmtAxis(xmin + ((xmax - xmin) * t) / 4, xd)));
    }
    if (ymin < 0 && ymax > 0) {
      const yy = y(0);
      svg.appendChild(svgEl('line', { x1: m.l, x2: m.l + iw, y1: yy, y2: yy, stroke: '#cbd5e1', 'stroke-width': 1, 'stroke-dasharray': '4 4' }));
    }
    if (xmin < 0 && xmax > 0) {
      const xx = x(0);
      svg.appendChild(svgEl('line', { x1: xx, x2: xx, y1: m.t, y2: m.t + ih, stroke: '#cbd5e1', 'stroke-width': 1, 'stroke-dasharray': '4 4' }));
    }

    const stride = rows.length > 1400 ? Math.ceil(rows.length / 1400) : 1;
    for (let i = 0; i < rows.length; i += stride) {
      const r = rows[i];
      const xv = r.f[xKey], yv = r.f[yKey];
      if (!Number.isFinite(xv) || !Number.isFinite(yv)) continue;
      const c = svgEl('circle', { cx: x(xv).toFixed(1), cy: y(yv).toFixed(1), r: 2.7, fill: color(r.cluster), opacity: 0.72 });
      c.appendChild(svgEl('title', {}, `${r.dateLabel} · ${r.ticker} · C${r.cluster + 1} · ${xf.short}=${fmt(xv, 4)} · ${yf.short}=${fmt(yv, 4)}`));
      svg.appendChild(c);
    }

    svg.appendChild(svgEl('text', { x: m.l + iw / 2, y: H - 12, 'text-anchor': 'middle', 'font-size': 10.5, fill: '#64748b' }, xf.label));
    svg.appendChild(svgEl('text', {
      x: 12, y: m.t + ih / 2, 'text-anchor': 'middle', 'font-size': 10.5, fill: '#64748b',
      transform: `rotate(-90 12 ${m.t + ih / 2})`
    }, yf.label));
    wrap.appendChild(svg);
  }

  function drawForward(result) {
    const wrap = $('fwdChart');
    const rows = result.summaries.filter((s) => s.forward20 != null && Number.isFinite(s.forward20));
    if (!rows.length) {
      wrap.innerHTML = '<div class="chart-empty">Không đủ dữ liệu tương lai để tính R20 (cần thêm 20 phiên sau cửa sổ).</div>';
      return;
    }
    wrap.innerHTML = '';
    const vals = rows.map((s) => s.forward20 * 100);
    let maxAbs = Math.max.apply(null, vals.map((v) => Math.abs(v)));
    maxAbs = Math.max(maxAbs * 1.15, 0.5);
    const W = 860, H = 270, m = { l: 54, r: 18, t: 20, b: 42 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const y = (v) => m.t + ih - ((v + maxAbs) / (2 * maxAbs)) * ih;
    const svg = baseSvg(W, H, 'Lợi suất 20 phiên sau theo cụm');

    [-maxAbs, 0, maxAbs].forEach((v) => {
      const yy = y(v);
      svg.appendChild(svgEl('line', { x1: m.l, x2: m.l + iw, y1: yy, y2: yy, stroke: v === 0 ? '#94a3b8' : '#e6ecf4', 'stroke-width': 1 }));
      svg.appendChild(svgEl('text', { x: m.l - 8, y: yy + 4, 'text-anchor': 'end', 'font-size': 10.5, fill: '#64748b' }, v.toFixed(1) + '%'));
    });

    const slot = iw / rows.length;
    const bw = Math.min(96, slot * 0.52);
    rows.forEach((s, i) => {
      const v = s.forward20 * 100;
      const cx = m.l + slot * (i + 0.5);
      const y0 = y(0), y1 = y(v);
      const top = Math.min(y0, y1), h = Math.max(2, Math.abs(y1 - y0));
      const rect = svgEl('rect', {
        x: (cx - bw / 2).toFixed(1), y: top.toFixed(1), width: bw.toFixed(1), height: h.toFixed(1),
        rx: 4, fill: color(s.cluster), opacity: 0.88
      });
      rect.appendChild(svgEl('title', {}, `C${s.cluster + 1} · R20 ${v.toFixed(2)}% · n=${s.n}`));
      svg.appendChild(rect);
      svg.appendChild(svgEl('text', {
        x: cx, y: v >= 0 ? y1 - 7 : y1 + 14, 'text-anchor': 'middle',
        'font-size': 11, 'font-weight': 700, fill: v >= 0 ? '#0b7a5f' : '#b42318'
      }, (v >= 0 ? '+' : '') + v.toFixed(2) + '%'));
      svg.appendChild(svgEl('text', { x: cx, y: m.t + ih + 23, 'text-anchor': 'middle', 'font-size': 11, fill: '#475569' }, 'C' + (s.cluster + 1)));
    });
    wrap.appendChild(svg);
  }

  function renderObsFilter(result) {
    const items = [{ value: 'all', label: 'Tất cả cụm' }].concat(
      result.summaries.map((s) => ({ value: String(s.cluster), label: 'Cụm C' + (s.cluster + 1) }))
    );
    fillSelect($('obsFilter'), items, true);
  }

  function renderObservations() {
    if (!state.result) return;
    const filter = $('obsFilter').value;
    let rows = state.result.windows.slice();
    if (filter !== 'all') rows = rows.filter((w) => String(w.cluster) === filter);
    rows.sort((a, b) => {
      const av = a.ts == null ? -1 : a.ts, bv = b.ts == null ? -1 : b.ts;
      return bv - av;
    });
    const top = rows.slice(0, 60);
    const tbody = $('obsBody');
    tbody.innerHTML = '';
    top.forEach((w) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${esc(w.dateLabel)}</td>
        <td>${esc(w.ticker)}</td>
        <td class="num">${w.close.toFixed(2)}</td>
        <td class="num">${fmtPct(w.f.drift, 3)}</td>
        <td class="num">${fmtPct(w.f.vol, 3)}</td>
        <td class="num">${fmt(w.f.clv, 3)}</td>
        <td class="num">${fmt(w.f.volz, 2)}</td>
        <td class="num">${fmt(w.f.cmf, 3)}</td>
        <td>${clusterChip(w.cluster)}</td>`;
      tbody.appendChild(tr);
    });
    $('obsCount').textContent = `${rows.length.toLocaleString('vi-VN')} quan sát · hiển thị ${top.length}`;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
