/* NCKH VN30 prototype – core logic (no DOM dependencies) */
(function (root) {
  'use strict';

  const FEATURES = [
    { key: 'drift', label: 'Drift', short: 'Drift', desc: 'Lợi suất trung bình trong cửa sổ' },
    { key: 'vol', label: 'Biến động', short: 'Vol', desc: 'Độ lệch chuẩn lợi suất' },
    { key: 'range', label: 'Biên độ', short: 'Range', desc: 'Trung bình log(High/Low)' },
    { key: 'clv', label: 'CLV', short: 'CLV', desc: 'Vị trí giá đóng cửa trong biên độ' },
    { key: 'volz', label: 'Vol Z', short: 'VolZ', desc: 'Z-score khối lượng so với 60 phiên' },
    { key: 'illiq', label: 'ILLIQ', short: 'ILLIQ', desc: 'log(1 + Amihud × 1e9)' },
    { key: 'cmf', label: 'CMF', short: 'CMF', desc: 'Chaikin Money Flow' },
    { key: 'obvSlope', label: 'OBV slope', short: 'OBV', desc: 'Độ dốc OBV đã chuẩn hóa' }
  ];
  const CLUSTER_COLORS = ['#2f6fed', '#0f9d8a', '#d97706', '#9333ea', '#dc2626', '#0891b2'];

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function randn(rng) {
    let u = 0, v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function mean(a) { return a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0; }
  function median(a) {
    if (!a.length) return 0;
    const b = a.slice().sort((x, y) => x - y);
    const m = Math.floor(b.length / 2);
    return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2;
  }
  function std(a, sample) {
    if (a.length < 2) return 0;
    const m = mean(a);
    const s = a.reduce((acc, x) => acc + (x - m) * (x - m), 0);
    return Math.sqrt(s / (a.length - (sample ? 1 : 0)));
  }
  function dist2(a, b) {
    let s = 0;
    for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; s += d * d; }
    return s;
  }

  function normalizeHeader(s) {
    return String(s == null ? '' : s)
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd').replace(/Đ/g, 'D')
      .toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  const ALIASES = {
    date: ['date', 'ngay', 'ngaythang', 'time', 'tradingdate', 'datetime', 'ngaygiaodich'],
    ticker: ['ticker', 'symbol', 'ma', 'macophieu', 'code', 'stockcode', 'mahieu'],
    open: ['open', 'mocua', 'giacua', 'openprice', 'giamo'],
    high: ['high', 'caonhat', 'giacaonhat', 'highprice', 'giacao'],
    low: ['low', 'thapnhat', 'giathapnhat', 'lowprice', 'giathap'],
    close: ['close', 'dongcua', 'giadongcua', 'closeprice', 'price', 'giadong'],
    volume: ['volume', 'khoiluong', 'kl', 'vol', 'klgd', 'volumegiaodich'],
    value: ['value', 'giatri', 'giatrigiaodich', 'turnover', 'giatritiente', 'gttt']
  };

  function mapColumns(headers) {
    const norm = headers.map(normalizeHeader);
    const find = (list) => norm.findIndex((h) => list.indexOf(h) !== -1);
    return {
      date: find(ALIASES.date),
      ticker: find(ALIASES.ticker),
      open: find(ALIASES.open),
      high: find(ALIASES.high),
      low: find(ALIASES.low),
      close: find(ALIASES.close),
      volume: find(ALIASES.volume),
      value: find(ALIASES.value)
    };
  }

  function parseNumber(v) {
    if (typeof v === 'number') return v;
    if (v == null) return NaN;
    let s = String(v).trim().replace(/\s|\u00a0/g, '').replace(/[^\d.,()\-]/g, '');
    if (!s) return NaN;
    let neg = false;
    if (s[0] === '(' && s[s.length - 1] === ')') { neg = true; s = s.slice(1, -1); }
    const dots = (s.match(/\./g) || []).length;
    const commas = (s.match(/,/g) || []).length;
    if (dots && commas) {
      if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(/,/g, '.');
      else s = s.replace(/,/g, '');
    } else if (commas) {
      const parts = s.split(',');
      if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3 && parts[0].length <= 3)) s = s.replace(/,/g, '');
      else s = s.replace(/,/g, '.');
    } else if (dots) {
      const parts = s.split('.');
      if (parts.length > 2) s = s.replace(/\./g, '');
      else if (parts.length === 2 && parts[1].length === 3 && parts[0] !== '0' && parts[0].length <= 3) s = s.replace(/\./g, '');
    }
    const n = Number(s);
    if (!isFinite(n)) return NaN;
    return neg ? -n : n;
  }

  function parseDate(v) {
    if (v == null || v === '') return null;
    if (v instanceof Date && !isNaN(v.getTime())) return v;
    const s = String(v).trim();
    if (/^\d{5}$/.test(s)) {
      const d = new Date(Date.UTC(1899, 11, 30) + Number(s) * 86400000);
      return isNaN(d.getTime()) ? null : d;
    }
    let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (m) {
      const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
      return d.getUTCFullYear() === +m[1] ? d : null;
    }
    m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
    if (m) {
      const d = new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
      return d.getUTCFullYear() === +m[3] ? d : null;
    }
    return null;
  }

  function formatDate(d) {
    if (!d) return '';
    const p = (x) => String(x).padStart(2, '0');
    return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
  }

  function splitCSVLine(line, delim) {
    const out = []; let cur = ''; let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) {
        if (ch === '"') {
          if (line[i + 1] === '"') { cur += '"'; i++; } else q = false;
        } else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === delim) { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out;
  }

  function detectDelimiter(line) {
    const counts = { ',': 0, ';': 0, '\t': 0 };
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') q = !q;
      else if (!q && counts[ch] != null) counts[ch]++;
    }
    return Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || ',';
  }

  function parseCSV(text) {
    if (text == null) throw new Error('File CSV rỗng.');
    text = String(text).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    const lines = text.split('\n').filter((l) => l.trim().length);
    if (lines.length < 2) throw new Error('CSV cần dòng tiêu đề và ít nhất một dòng dữ liệu.');
    const delim = detectDelimiter(lines[0]);
    const headers = splitCSVLine(lines[0], delim).map((h) => h.trim());
    const rows = lines.slice(1)
      .filter((l) => l.trim().length)
      .map((l) => splitCSVLine(l, delim).map((c) => c.trim()));
    return { headers, rows, delimiter: delim };
  }

  function buildRecords(parsed) {
    const col = mapColumns(parsed.headers);
    if (col.close < 0) throw new Error('Không tìm thấy cột giá đóng cửa (Close / Đóng cửa).');
    if (col.volume < 0) throw new Error('Không tìm thấy cột khối lượng (Volume / Khối lượng).');
    const records = [];
    parsed.rows.forEach((row, i) => {
      const close = parseNumber(row[col.close]);
      const volume = parseNumber(row[col.volume]);
      if (!isFinite(close) || close <= 0 || !isFinite(volume) || volume < 0) return;
      const openRaw = col.open >= 0 ? parseNumber(row[col.open]) : NaN;
      const highRaw = col.high >= 0 ? parseNumber(row[col.high]) : NaN;
      const lowRaw = col.low >= 0 ? parseNumber(row[col.low]) : NaN;
      const open = isFinite(openRaw) && openRaw > 0 ? openRaw : close;
      let high = isFinite(highRaw) && highRaw > 0 ? highRaw : Math.max(open, close);
      let low = isFinite(lowRaw) && lowRaw > 0 ? lowRaw : Math.min(open, close);
      high = Math.max(high, open, close);
      low = Math.min(low, open, close);
      const valueRaw = col.value >= 0 ? parseNumber(row[col.value]) : NaN;
      const value = isFinite(valueRaw) && valueRaw > 0 ? valueRaw : close * volume;
      const date = col.date >= 0 ? parseDate(row[col.date]) : null;
      const rawDate = col.date >= 0 ? String(row[col.date] || '').trim() : '';
      const ticker = col.ticker >= 0 ? String(row[col.ticker] || '').trim() : '';
      records.push({
        ticker: ticker || 'DEMO',
        i,
        ts: date ? date.getTime() : null,
        dateLabel: date ? formatDate(date) : (rawDate || `#${i + 1}`),
        open, high, low, close, volume, value
      });
    });
    if (!records.length) throw new Error('Không có dòng dữ liệu hợp lệ (cần Close > 0 và Volume ≥ 0).');
    return records;
  }

  function rollingZ(arr, lookback) {
    const out = new Array(arr.length).fill(0);
    for (let i = 0; i < arr.length; i++) {
      const s = Math.max(0, i - lookback + 1);
      const seg = arr.slice(s, i + 1);
      if (seg.length < 5) continue;
      const m = mean(seg), sd = std(seg, false);
      out[i] = sd > 1e-12 ? (arr[i] - m) / sd : 0;
    }
    return out;
  }

  function linregSlope(y) {
    const n = y.length;
    if (n < 2) return 0;
    const xm = (n - 1) / 2, ym = mean(y);
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) {
      num += (i - xm) * (y[i] - ym);
      den += (i - xm) * (i - xm);
    }
    return den > 1e-12 ? num / den : 0;
  }

  function computeWindows(records, W, step) {
    const byTicker = new Map();
    records.forEach((r, idx) => {
      if (!byTicker.has(r.ticker)) byTicker.set(r.ticker, []);
      byTicker.get(r.ticker).push({ ...r, _i: idx });
    });
    const groups = [];
    const windows = [];

    byTicker.forEach((list, ticker) => {
      list.sort((a, b) => {
        const av = a.ts == null ? a._i : a.ts;
        const bv = b.ts == null ? b._i : b.ts;
        return av - bv;
      });
      const n = list.length;
      groups.push({ ticker, n, used: n >= W + 2 });
      if (n < W + 2) return;

      const close = list.map((x) => x.close);
      const high = list.map((x) => x.high);
      const low = list.map((x) => x.low);
      const volume = list.map((x) => x.volume);
      const value = list.map((x) => (x.value > 0 ? x.value : x.close * x.volume));
      const ret = new Array(n).fill(0);
      const clv = new Array(n).fill(0);
      for (let i = 1; i < n; i++) ret[i] = close[i] / close[i - 1] - 1;
      for (let i = 0; i < n; i++) {
        const hl = high[i] - low[i];
        clv[i] = hl > 1e-12 ? ((close[i] - low[i]) - (high[i] - close[i])) / hl : 0;
      }
      const volz = rollingZ(volume, 60);
      const obv = new Array(n).fill(0);
      for (let i = 1; i < n; i++) {
        obv[i] = obv[i - 1] + (close[i] > close[i - 1] ? volume[i] : close[i] < close[i - 1] ? -volume[i] : 0);
      }

      for (let end = W - 1; end < n; end += step) {
        const start = end - W + 1;
        const rs = ret.slice(Math.max(start, 1), end + 1).filter(Number.isFinite);
        const drift = mean(rs);
        const vol = std(rs, true);
        let rangeSum = 0, rangeN = 0;
        let clvSum = 0, volzSum = 0;
        let illiqSum = 0, illiqN = 0;
        let mfv = 0, volSum = 0;
        for (let k = start; k <= end; k++) {
          if (low[k] > 0 && high[k] > 0) { rangeSum += Math.log(high[k] / low[k]); rangeN++; }
          clvSum += clv[k];
          volzSum += volz[k];
          const val = value[k];
          if (val > 0 && k > 0 && Number.isFinite(ret[k])) { illiqSum += Math.abs(ret[k]) / val; illiqN++; }
          mfv += clv[k] * volume[k];
          volSum += volume[k];
        }
        const obvSeg = obv.slice(start, end + 1);
        const obvMean = mean(obvSeg), obvSd = std(obvSeg, false);
        const obvNorm = obvSeg.map((v) => (obvSd > 1e-12 ? (v - obvMean) / obvSd : 0));
        const f = {
          drift,
          vol,
          range: rangeN ? rangeSum / rangeN : 0,
          clv: clvSum / W,
          volz: volzSum / W,
          illiq: illiqN ? Math.log1p((illiqSum / illiqN) * 1e9) : 0,
          cmf: volSum > 1e-12 ? mfv / volSum : 0,
          obvSlope: linregSlope(obvNorm)
        };
        Object.keys(f).forEach((key) => { if (!isFinite(f[key])) f[key] = 0; });
        windows.push({
          ticker,
          end,
          dateLabel: list[end].dateLabel,
          ts: list[end].ts,
          close: close[end],
          f,
          forward20: end + 20 < n ? close[end + 20] / close[end] - 1 : null
        });
      }
    });
    return { windows, groups };
  }

  function standardize(windows) {
    const keys = FEATURES.map((f) => f.key);
    const stats = {};
    keys.forEach((key) => {
      const vals = windows.map((w) => w.f[key]).filter(Number.isFinite);
      const m = mean(vals), s = std(vals, true);
      stats[key] = { mean: m, std: s };
    });
    windows.forEach((w) => {
      w.z = {};
      keys.forEach((key) => {
        const s = stats[key];
        w.z[key] = s.std > 1e-12 ? (w.f[key] - s.mean) / s.std : 0;
      });
    });
    return stats;
  }

  function initKmeansPP(points, k, rng) {
    const n = points.length;
    const centroids = [points[Math.floor(rng() * n)].slice()];
    while (centroids.length < k) {
      const d2 = new Array(n);
      let sum = 0;
      for (let i = 0; i < n; i++) {
        let best = Infinity;
        for (let c = 0; c < centroids.length; c++) best = Math.min(best, dist2(points[i], centroids[c]));
        d2[i] = best;
        sum += best;
      }
      if (sum <= 1e-15) {
        centroids.push(points[Math.floor(rng() * n)].slice());
        continue;
      }
      let r = rng() * sum, idx = 0;
      while (idx < n - 1 && r > d2[idx]) { r -= d2[idx]; idx++; }
      centroids.push(points[idx].slice());
    }
    return centroids;
  }

  function kmeans(points, k, seed) {
    const n = points.length;
    k = clamp(Math.round(k), 2, Math.max(2, Math.min(8, n - 1)));
    const rng = mulberry32(seed || 42);
    const restarts = n > 1500 ? 8 : 16;
    let best = null;

    for (let run = 0; run < restarts; run++) {
      let centroids = initKmeansPP(points, k, rng);
      let labels = new Array(n).fill(-1);
      let changed = true, iter = 0;
      for (; iter < 80 && changed; iter++) {
        changed = false;
        for (let i = 0; i < n; i++) {
          let bestC = 0, bestD = Infinity;
          for (let c = 0; c < k; c++) {
            const d = dist2(points[i], centroids[c]);
            if (d < bestD) { bestD = d; bestC = c; }
          }
          if (labels[i] !== bestC) { labels[i] = bestC; changed = true; }
        }
        const sums = Array.from({ length: k }, () => new Array(points[0].length).fill(0));
        const counts = new Array(k).fill(0);
        for (let i = 0; i < n; i++) {
          const l = labels[i];
          counts[l]++;
          for (let d = 0; d < points[i].length; d++) sums[l][d] += points[i][d];
        }
        for (let c = 0; c < k; c++) {
          if (counts[c] === 0) {
            let far = 0, farD = -1;
            for (let i = 0; i < n; i++) {
              const d = dist2(points[i], centroids[labels[i]]);
              if (d > farD) { farD = d; far = i; }
            }
            labels[far] = c;
            counts[c] = 1;
            sums[c] = points[far].slice();
            continue;
          }
          for (let d = 0; d < centroids[c].length; d++) centroids[c][d] = sums[c][d] / counts[c];
        }
      }
      let inertia = 0;
      for (let i = 0; i < n; i++) inertia += dist2(points[i], centroids[labels[i]]);
      if (!best || inertia < best.inertia) {
        best = { labels: labels.slice(), centroids: centroids.map((c) => c.slice()), inertia, iterations: iter };
      }
    }

    const order = best.centroids.map((c, i) => i).sort((a, b) => best.centroids[a][0] - best.centroids[b][0]);
    const remap = {};
    order.forEach((old, idx) => { remap[old] = idx; });
    return {
      labels: best.labels.map((l) => remap[l]),
      centroids: order.map((i) => best.centroids[i]),
      inertia: best.inertia,
      iterations: best.iterations,
      k
    };
  }

  function silhouette(points, labels, k) {
    const n = points.length;
    if (n < 3 || k < 2) return 0;
    const maxN = 650;
    let idxs;
    if (n <= maxN) idxs = Array.from({ length: n }, (_, i) => i);
    else {
      idxs = [];
      const step = (n - 1) / (maxN - 1);
      for (let i = 0; i < maxN; i++) idxs.push(Math.round(i * step));
    }
    const m = idxs.length;
    const lab = idxs.map((i) => labels[i]);
    let total = 0, count = 0;
    for (let a = 0; a < m; a++) {
      const sums = new Array(k).fill(0);
      const cnts = new Array(k).fill(0);
      let sameSum = 0, sameN = 0;
      for (let b = 0; b < m; b++) {
        if (a === b) continue;
        const d = Math.sqrt(dist2(points[idxs[a]], points[idxs[b]]));
        const l = lab[b];
        sums[l] += d; cnts[l]++;
        if (l === lab[a]) { sameSum += d; sameN++; }
      }
      if (sameN === 0) continue;
      const ai = sameSum / sameN;
      let bi = Infinity;
      for (let l = 0; l < k; l++) {
        if (l === lab[a] || cnts[l] === 0) continue;
        bi = Math.min(bi, sums[l] / cnts[l]);
      }
      if (!isFinite(bi)) continue;
      total += (bi - ai) / Math.max(ai, bi, 1e-12);
      count++;
    }
    return count ? total / count : 0;
  }

  function chooseK(points, minK, maxK) {
    const scores = [];
    for (let k = minK; k <= maxK; k++) {
      if (points.length < k * 4) continue;
      const km = kmeans(points, k, 100 + k);
      const sil = silhouette(points, km.labels, k);
      const counts = new Array(k).fill(0);
      km.labels.forEach((l) => counts[l]++);
      scores.push({ k, silhouette: sil, inertia: km.inertia, minShare: Math.min(...counts) / points.length });
    }
    if (!scores.length) return { k: 2, scores };
    const valid = scores.filter((s) => s.minShare >= 0.05);
    const pool = valid.length ? valid : scores;
    const best = pool.reduce((a, b) => (b.silhouette > a.silhouette ? b : a));
    return { k: best.k, scores };
  }

  function summarize(windows, k) {
    const keys = FEATURES.map((f) => f.key);
    const acc = Array.from({ length: k }, () => ({
      n: 0, f: Object.fromEntries(keys.map((x) => [x, 0])), fwd: 0, fwdN: 0, tickers: new Set()
    }));
    windows.forEach((w) => {
      const a = acc[w.cluster];
      a.n++;
      keys.forEach((key) => { a.f[key] += w.f[key]; });
      if (w.forward20 != null && Number.isFinite(w.forward20)) { a.fwd += w.forward20; a.fwdN++; }
      a.tickers.add(w.ticker);
    });
    const rows = acc.map((a, j) => {
      const means = {};
      keys.forEach((key) => { means[key] = a.n ? a.f[key] / a.n : 0; });
      return {
        cluster: j,
        n: a.n,
        share: windows.length ? a.n / windows.length : 0,
        means,
        forward20: a.fwdN ? a.fwd / a.fwdN : null,
        tickers: a.tickers.size
      };
    });
    const byClv = rows.slice().sort((a, b) => b.means.clv - a.means.clv);
    rows.forEach((r) => { r.suggestion = 'Trung tính / chưa xác định'; r.tone = 'neutral'; });
    if (k >= 2 && byClv.length >= 2) {
      const top = byClv[0], bot = byClv[byClv.length - 1];
      const medVolZ = median(rows.map((r) => r.means.volz));
      if (top.means.clv - bot.means.clv > 0.02) {
        if (top.means.volz >= medVolZ && top.means.clv > 0) {
          top.suggestion = 'Tương thích tích lũy'; top.tone = 'acc';
        }
        if (bot.means.volz >= medVolZ && bot.means.clv < 0) {
          bot.suggestion = 'Tương thích phân phối'; bot.tone = 'dist';
        }
      }
    }
    return rows;
  }

  function analyze(records, opts) {
    opts = opts || {};
    const W = clamp(Math.round(opts.W || 20), 5, 120);
    const step = clamp(Math.round(opts.step || 1), 1, 30);
    const { windows, groups } = computeWindows(records, W, step);
    if (windows.length < 12) {
      throw new Error(`Chỉ có ${windows.length} cửa sổ hợp lệ. Cần thêm dữ liệu hoặc giảm W.`);
    }
    const stats = standardize(windows);
    const keys = FEATURES.map((f) => f.key);
    const points = windows.map((w) => keys.map((key) => w.z[key]));

    let k = opts.k;
    let kScores = null;
    if (k === 'auto' || k == null) {
      const auto = chooseK(points, 2, 6);
      k = auto.k;
      kScores = auto.scores;
    }
    k = clamp(parseInt(k, 10) || 3, 2, 6);
    if (windows.length < k * 4) k = Math.max(2, Math.floor(windows.length / 4));
    const km = kmeans(points, k, 42);
    km.labels.forEach((l, i) => { windows[i].cluster = l; });
    const sil = silhouette(points, km.labels, k);
    const summaries = summarize(windows, k);

    return {
      windows, groups, features: FEATURES, colors: CLUSTER_COLORS,
      k, labels: km.labels, centroids: km.centroids, inertia: km.inertia,
      silhouette: sil, kScores, summaries, stats,
      meta: {
        W, step, n: windows.length,
        tickers: groups.filter((g) => g.used).map((g) => g.ticker),
        totalTickers: groups.length,
        source: opts.source || ''
      }
    };
  }

  function csvEscape(v) {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function windowsToCSV(result) {
    const head = ['Date', 'Ticker', 'Close', 'Cluster', 'Drift', 'Vol', 'Range', 'CLV', 'VolZ', 'ILLIQ', 'CMF', 'OBVSlope', 'Forward20'];
    const lines = [head.join(',')];
    result.windows.forEach((w) => {
      lines.push([
        csvEscape(w.dateLabel), csvEscape(w.ticker), w.close.toFixed(4), 'C' + (w.cluster + 1),
        w.f.drift.toFixed(6), w.f.vol.toFixed(6), w.f.range.toFixed(6), w.f.clv.toFixed(6),
        w.f.volz.toFixed(6), w.f.illiq.toFixed(4), w.f.cmf.toFixed(6), w.f.obvSlope.toFixed(6),
        w.forward20 == null ? '' : w.forward20.toFixed(6)
      ].join(','));
    });
    return lines.join('\n');
  }

  function nextBusinessDay(d) {
    const n = new Date(d.getTime());
    do { n.setUTCDate(n.getUTCDate() + 1); } while (n.getUTCDay() === 0 || n.getUTCDay() === 6);
    return n;
  }

  function generateSample(opts) {
    opts = opts || {};
    const tickers = opts.tickers || ['VNM', 'FPT', 'HPG', 'VCB', 'BID', 'CTG', 'MWG', 'VIC', 'VHM', 'MSN'];
    const days = opts.days || 220;
    const rng = mulberry32(opts.seed || 2026);
    const rows = [];
    const start = new Date(Date.UTC(2023, 0, 3));

    tickers.forEach((ticker, ti) => {
      let date = new Date(start.getTime());
      let close = 35 + rng() * 90;
      let regimeLeft = 0, mu = 0, sigma = 0.012, volBase = 900000 + rng() * 1800000;
      let bias = 0, regimeType = 'neutral';
      for (let d = 0; d < days; d++) {
        if (regimeLeft <= 0) {
          regimeLeft = 24 + Math.floor(rng() * 26);
          const pick = rng();
          regimeType = pick < 0.30 ? 'acc' : pick < 0.60 ? 'dist' : pick < 0.80 ? 'trend' : 'neutral';
          if (regimeType === 'acc') {
            mu = (rng() - 0.5) * 0.0008;
            sigma = 0.007 + rng() * 0.005;
            volBase = 1200000 + rng() * 1800000;
            bias = 0.28;
          } else if (regimeType === 'dist') {
            mu = 0.0004 + rng() * 0.0012;
            sigma = 0.009 + rng() * 0.006;
            volBase = 1300000 + rng() * 2000000;
            bias = -0.28;
          } else if (regimeType === 'trend') {
            mu = (rng() < 0.5 ? -1 : 1) * (0.0012 + rng() * 0.0018);
            sigma = 0.010 + rng() * 0.008;
            volBase = 700000 + rng() * 1400000;
            bias = 0;
          } else {
            mu = (rng() - 0.5) * 0.0004;
            sigma = 0.006 + rng() * 0.004;
            volBase = 450000 + rng() * 900000;
            bias = 0;
          }
        }
        regimeLeft--;
        const ret = mu + sigma * randn(rng);
        const prev = close;
        const open = Math.max(1, prev * (1 + (rng() - 0.5) * 0.008));
        const closeNextRaw = Math.max(2, prev * Math.exp(ret));
        const wick = sigma * (0.6 + rng() * 1.1);
        let high = Math.max(open, closeNextRaw) * (1 + wick * 0.5);
        let low = Math.min(open, closeNextRaw) * (1 - wick * 0.5);
        const pos = clamp(0.5 + bias + (rng() - 0.5) * 0.18, 0.05, 0.95);
        const closeNext = low + pos * (high - low);
        high = Math.max(high, open, closeNext);
        low = Math.min(low, open, closeNext);
        const shock = Math.abs(ret) / Math.max(sigma, 1e-6);
        const volMult = regimeType === 'acc' || regimeType === 'dist' ? 1.35 : 1;
        const volume = Math.round(volBase * volMult * (0.55 + 0.9 * shock + rng() * 0.6));
        const value = Math.round(closeNext * volume);
        rows.push({
          date: date.toISOString().slice(0, 10),
          ticker,
          open: open.toFixed(2),
          high: high.toFixed(2),
          low: low.toFixed(2),
          close: closeNext.toFixed(2),
          volume: String(volume),
          value: String(value)
        });
        close = closeNext;
        date = nextBusinessDay(date);
      }
    });

    rows.sort((a, b) => (a.date === b.date ? a.ticker.localeCompare(b.ticker) : a.date.localeCompare(b.date)));
    const head = 'Date,Ticker,Open,High,Low,Close,Volume,Value';
    const body = rows.map((r) => [r.date, r.ticker, r.open, r.high, r.low, r.close, r.volume, r.value].join(','));
    return { csv: [head].concat(body).join('\n'), rows: rows.length, tickers: tickers.length, days };
  }

  const api = {
    FEATURES, CLUSTER_COLORS,
    parseCSV, buildRecords, parseNumber, parseDate, formatDate,
    computeWindows, standardize, kmeans, silhouette, chooseK, summarize, analyze,
    windowsToCSV, generateSample
  };
  root.NCKHCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
