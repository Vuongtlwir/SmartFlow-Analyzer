const c = require('./core.js');

function assert(cond, msg) { if (!cond) throw new Error('FAIL: ' + msg); console.log('ok - ' + msg); }

const sample = c.generateSample({ days: 220 });
console.log('sample rows', sample.rows, 'csv lines', sample.csv.split('\n').length);
const parsed = c.parseCSV(sample.csv);
assert(parsed.headers.length === 8, '8 headers');
const records = c.buildRecords(parsed);
assert(records.length === 2200, '2200 records');

const res = c.analyze(records, { W: 20, step: 1, k: 3, source: 'test' });
console.log('windows', res.windows.length, 'k', res.k, 'sil', res.silhouette.toFixed(3));
assert(res.windows.length === 2010, '2010 windows');
assert(res.summaries.length === 3, '3 clusters');
assert(res.windows.every((w) => Object.values(w.f).every(Number.isFinite)), 'features finite');
assert(res.windows.every((w) => Object.values(w.z).every(Number.isFinite)), 'z finite');
assert(res.summaries.every((s) => s.n > 0), 'nonempty clusters');
console.log(res.summaries.map((s) => ({
  c: s.cluster + 1, n: s.n, share: s.share.toFixed(2), drift: s.means.drift.toFixed(5),
  clv: s.means.clv.toFixed(3), fwd: s.forward20 == null ? null : s.forward20.toFixed(4), sug: s.suggestion
})));

const auto = c.analyze(records, { W: 20, step: 1, k: 'auto' });
console.log('auto k', auto.k, 'sil', auto.silhouette.toFixed(3), 'scores', auto.kScores.map((s) => `${s.k}:${s.silhouette.toFixed(3)}`).join(' '));
assert(auto.k >= 2 && auto.k <= 6, 'auto k range');

assert(Math.abs(c.parseNumber('1.234,56') - 1234.56) < 1e-9, 'parse 1.234,56');
assert(Math.abs(c.parseNumber('1,234.56') - 1234.56) < 1e-9, 'parse 1,234.56');
assert(c.parseNumber('1.234') === 1234, 'parse thousands dot');
assert(Math.abs(c.parseNumber('0.123') - 0.123) < 1e-9, 'parse decimal');

const vnRows = ['Ngày;Mã;Mở cửa;Cao nhất;Thấp nhất;Đóng cửa;Khối lượng;Giá trị'];
for (let i = 0; i < 140; i++) {
  const p = 50 + Math.sin(i / 7) * 3 + i * 0.01;
  const v = 1000000 + (i % 13) * 50000;
  const date = new Date(Date.UTC(2023, 0, 2) + i * 86400000).toISOString().slice(0, 10);
  vnRows.push([date, 'VCB', (p - 0.2).toFixed(2), (p + 0.6).toFixed(2), (p - 0.7).toFixed(2), p.toFixed(2), v, Math.round(p * v)].join(';'));
}
const vnParsed = c.parseCSV(vnRows.join('\n'));
const vnRecords = c.buildRecords(vnParsed);
const vnRes = c.analyze(vnRecords, { W: 20, step: 1, k: 2 });
assert(vnRes.windows.length > 100, 'vietnamese headers + semicolon');
console.log('vn windows', vnRes.windows.length, 'sil', vnRes.silhouette.toFixed(3));

const csvOut = c.windowsToCSV(res);
assert(csvOut.split('\n').length === res.windows.length + 1, 'export csv rows');
console.log('ALL TESTS PASSED');
