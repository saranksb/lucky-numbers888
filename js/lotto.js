'use strict';
// เลขมงคล (Gambler's Fallacy) - เครื่องมือสนุกๆ ไม่ใช่การพยากรณ์จริง
// เก็บ "เลขที่เคยซื้อ" ไว้ในเครื่อง (localStorage) และดึง "ผลรางวัลย้อนหลัง" จาก API สาธารณะ
// ที่รวบรวมผลสลากกินแบ่งรัฐบาลไทย (ไม่มี API ทางการจาก glo.or.th ให้เรียกตรงๆ จากเบราว์เซอร์ได้ -
// เว็บ glo.or.th render ด้วย JS และไม่เปิด CORS ให้หน้าอื่นดึงข้อมูลข้ามโดเมน)
const DEFAULT_API_BASE = 'https://lottery.api.rayriffy.com';
const LS = {
  tickets: 'lotto_tickets_v1',
  cache: 'lotto_results_cache_v1',
  apiBase: 'lotto_api_base_v1',
};

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const pad = n => String(n).padStart(2, '0');
const fmtISO = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const fmtAPI = d => pad(d.getDate()) + '-' + pad(d.getMonth() + 1) + '-' + d.getFullYear();
const fmtTH = iso => { const d = new Date(iso + 'T00:00'); return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' }); };
const onlyDigits = s => String(s || '').replace(/\D/g, '');

/* ---------- localStorage helpers ---------- */
function readJSON(key, fallback) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; } }
function writeJSON(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {} }
function getApiBase() { return localStorage.getItem(LS.apiBase) || DEFAULT_API_BASE; }
function setApiBase(v) { try { localStorage.setItem(LS.apiBase, v || ''); } catch (e) {} }

/* ---------- วันงวด: สลากออกทุกวันที่ 1 และ 16 ---------- */
function latestDrawOnOrBefore(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() >= 16 ? 16 : 1);
  return d;
}
function prevDrawDate(d) {
  if (d.getDate() === 16) return new Date(d.getFullYear(), d.getMonth(), 1);
  return new Date(d.getFullYear(), d.getMonth() - 1, 16);
}
function nextDrawDate(d) {
  if (d.getDate() === 1) return new Date(d.getFullYear(), d.getMonth(), 16);
  return new Date(d.getFullYear(), d.getMonth() + 1, 1);
}
function drawSeries(count, fromDate) {
  const out = []; let d = latestDrawOnOrBefore(fromDate || new Date());
  for (let i = 0; i < count; i++) { out.push(new Date(d)); d = prevDrawDate(d); }
  return out;
}

/* ---------- ดึงผลรางวัลจาก API และแปลงให้เป็นรูปแบบกลาง ---------- */
// รูปแบบกลาง: { date:'YYYY-MM-DD', prizeFirst:'123456'|null, front3:['123','456'], back3:['789','012'], back2:'45'|null }
function normalizeDraw(json, isoFallback) {
  const raw = json && (json.response || json);
  if (!raw) return null;
  const prizes = raw.prizes || [];
  const runningNumbers = raw.runningNumbers || [];
  const findPrize = id => prizes.find(p => p.id === id) ||
    prizes.find(p => p.name && p.name.includes('รางวัลที่ 1') && !p.name.includes('ข้างเคียง'));
  const findRunning = (id, include, exclude) => runningNumbers.find(r => r.id === id) ||
    runningNumbers.find(r => r.name && r.name.includes(include) && !(exclude && r.name.includes(exclude)));
  const p1 = findPrize('prizeFirst');
  const f3 = findRunning('runningNumberFrontThree', 'หน้า 3');
  const b3 = findRunning('runningNumberBackThree', 'ท้าย 3');
  const b2 = findRunning('runningNumberBackTwo', 'ท้าย 2', 'ท้าย 3');
  let iso = isoFallback;
  if (!iso && raw.endDate) iso = String(raw.endDate).slice(0, 10);
  if (!iso) return null;
  return {
    date: iso,
    prizeFirst: (p1 && p1.runningNumbers && p1.runningNumbers[0]) || null,
    front3: (f3 && f3.number) || [],
    back3: (b3 && b3.number) || [],
    back2: (b2 && b2.number && b2.number[0]) || null,
  };
}

async function fetchDrawByDate(dateObj) {
  const iso = fmtISO(dateObj);
  const cache = readJSON(LS.cache, {});
  if (cache[iso]) return cache[iso];
  const res = await fetch(`${getApiBase()}/lotto/${fmtAPI(dateObj)}`);
  if (!res.ok) throw new Error('งวดนี้ไม่มีผล (' + res.status + ')');
  const json = await res.json();
  const draw = normalizeDraw(json, iso);
  if (draw) { cache[iso] = draw; writeJSON(LS.cache, cache); }
  return draw;
}

async function fetchLatestDraw() {
  const res = await fetch(`${getApiBase()}/latest`);
  if (!res.ok) throw new Error('เชื่อมต่อ API ไม่สำเร็จ (' + res.status + ')');
  const json = await res.json();
  const draw = normalizeDraw(json, null);
  if (draw && draw.date) { const cache = readJSON(LS.cache, {}); cache[draw.date] = draw; writeJSON(LS.cache, cache); }
  return draw;
}

function historyFromCache() {
  const cache = readJSON(LS.cache, {});
  return Object.values(cache).sort((a, b) => a.date.localeCompare(b.date));
}

// เติมข้อมูลตั้งต้นให้อัตโนมัติตอนเปิดแอปครั้งแรกบนเครื่อง/เบราว์เซอร์ใหม่ (ไม่ทับข้อมูลที่มีอยู่แล้ว)
function seedIfEmpty() {
  const cache = readJSON(LS.cache, {});
  if (Object.keys(cache).length > 0) return;
  if (typeof SEED_DRAWS === 'undefined' || !SEED_DRAWS.length) return;
  const seeded = {};
  SEED_DRAWS.forEach(d => { seeded[d.date] = d; });
  writeJSON(LS.cache, seeded);
}

/* ---------- คำนวณตัวชี้วัด "ค้างงวด" (Gambler's Fallacy) ---------- */
function computeValueOverdue(history, extractor, space) {
  const lastSeen = {}, freq = {};
  space.forEach(v => { lastSeen[v] = -1; freq[v] = 0; });
  history.forEach((draw, i) => extractor(draw).forEach(v => { if (v == null) return; lastSeen[v] = i; freq[v] = (freq[v] || 0) + 1; }));
  const n = history.length;
  return space.map(v => ({ value: v, gap: lastSeen[v] === -1 ? n : (n - 1 - lastSeen[v]), freq: freq[v] || 0 }))
    .sort((a, b) => b.gap - a.gap || a.freq - b.freq || a.value.localeCompare(b.value));
}
function computeDigitOverdue(history, extractor, posCount) {
  const n = history.length, perPos = [];
  for (let p = 0; p < posCount; p++) {
    const lastSeen = {}, freq = {};
    for (let d = 0; d < 10; d++) { lastSeen[d] = -1; freq[d] = 0; }
    history.forEach((draw, i) => extractor(draw).forEach(numStr => {
      if (!numStr || numStr.length <= p) return;
      const dg = numStr[p]; lastSeen[dg] = i; freq[dg] = (freq[dg] || 0) + 1;
    }));
    const list = Array.from({ length: 10 }, (_, d) => String(d))
      .map(dg => ({ digit: dg, gap: lastSeen[dg] === -1 ? n : (n - 1 - lastSeen[dg]), freq: freq[dg] || 0 }));
    list.sort((a, b) => b.gap - a.gap || a.freq - b.freq || a.digit.localeCompare(b.digit));
    perPos.push(list);
  }
  return perPos;
}
const EXTRACT = {
  back2: draw => draw.back2 ? [draw.back2] : [],
  front3: draw => draw.front3 || [],
  back3: draw => draw.back3 || [],
  prizeFirst: draw => draw.prizeFirst ? [draw.prizeFirst] : [],
};
const BACK2_SPACE = Array.from({ length: 100 }, (_, i) => pad(i));
const POS_COUNT = { front3: 3, back3: 3, prizeFirst: 6 };
const POS_LABEL = {
  front3: ['ร้อย (หน้า)', 'สิบ (หน้า)', 'หน่วย (หน้า)'],
  back3: ['ร้อย (ท้าย)', 'สิบ (ท้าย)', 'หน่วย (ท้าย)'],
  prizeFirst: ['หลัก 1', 'หลัก 2', 'หลัก 3', 'หลัก 4', 'หลัก 5', 'หลัก 6'],
};

/* ---------- state ---------- */
let HISTORY = [];

/* ---------- render: ตั้งค่า ---------- */
function initSettings() {
  $('#api-base').value = getApiBase();
  $('#api-base').addEventListener('change', e => { setApiBase(e.target.value.trim()); setStatus('#api-status', 'บันทึกแล้ว'); });
  $('#btn-reset-api').addEventListener('click', () => { setApiBase(''); $('#api-base').value = DEFAULT_API_BASE; setStatus('#api-status', 'รีเซ็ตแล้ว'); });
  $('#btn-clear-cache').addEventListener('click', () => {
    if (!confirm('ล้างแคชผลรางวัลที่ดึงมาทั้งหมด?')) return;
    localStorage.removeItem(LS.cache); HISTORY = []; renderHistory(); renderIndicators();
    setStatus('#api-status', 'ล้างแคชแล้ว');
  });
}
function setStatus(sel, msg) { const el = $(sel); if (el) { el.textContent = msg; } }

/* ---------- render: เลขที่เคยซื้อ ---------- */
function getTickets() { return readJSON(LS.tickets, []); }
function saveTickets(list) { writeJSON(LS.tickets, list); }
const TYPE_LABEL = { back2: 'ท้าย 2 ตัว', front3: '3 ตัวหน้า', back3: '3 ตัวท้าย', prizeFirst: 'รางวัลที่ 1' };
const TYPE_MAXLEN = { back2: 2, front3: 3, back3: 3, prizeFirst: 6 };

const PRIZE_AMOUNT = { back2: 2000, front3: 4000, back3: 4000, prizeFirst: 6000000 };
const baht = n => Number(n).toLocaleString('th-TH');
function renderTicketStats() {
  const list = getTickets();
  let wins = 0, spent = 0, spentCount = 0, won = 0;
  list.forEach(tk => {
    if (checkTicket(tk) === 'win') { wins++; won += PRIZE_AMOUNT[tk.type] || 0; }
    if (tk.amount != null) { spent += Number(tk.amount) || 0; spentCount++; }
  });
  const total = list.length;
  const winRate = total ? Math.round(wins / total * 1000) / 10 + '%' : '-';
  const net = won - spent;
  const tiles = [
    { v: total, l: 'จำนวนที่ซื้อ' },
    { v: wins, l: 'ถูกกี่ครั้ง' },
    { v: winRate, l: 'อัตราถูก' },
    { v: spentCount ? baht(spent) : '-', l: 'ยอดซื้อ (กรอกแล้ว)' },
    { v: won ? baht(won) : '-', l: 'ยอดรางวัลที่ได้', cls: 'gold' },
    { v: (spentCount || won) ? (net >= 0 ? '+' : '') + baht(net) : '-', l: 'กำไร/ขาดทุน' },
  ];
  $('#tk-stats').innerHTML = tiles.map(t => `<div class="stat-tile"><div class="v ${t.cls || ''}">${esc(t.v)}</div><div class="l">${t.l}</div></div>`).join('');
}

function checkTicket(tk) {
  const draw = HISTORY.find(d => d.date === tk.date);
  if (!draw) return 'pending';
  if (tk.type === 'back2') return draw.back2 === tk.number ? 'win' : 'lose';
  if (tk.type === 'prizeFirst') return draw.prizeFirst === tk.number ? 'win' : 'lose';
  if (tk.type === 'front3') return draw.front3.includes(tk.number) ? 'win' : 'lose';
  if (tk.type === 'back3') return draw.back3.includes(tk.number) ? 'win' : 'lose';
  return 'pending';
}
function renderTickets() {
  const list = getTickets().sort((a, b) => b.date.localeCompare(a.date));
  const body = $('#tk-body'); body.innerHTML = '';
  $('#tk-empty').hidden = list.length > 0;
  list.forEach(tk => {
    const status = checkTicket(tk);
    const tr = document.createElement('tr');
    const badge = status === 'win' ? '<span class="badge win">ถูก!</span>' : status === 'lose' ? '<span class="badge lose">ไม่ถูก</span>' : '<span class="badge pending">รอผล</span>';
    tr.innerHTML = `<td>${fmtTH(tk.date)}</td><td>${TYPE_LABEL[tk.type]}</td><td class="num">${esc(tk.number)}</td><td>${badge}</td><td><button class="del" data-id="${tk.id}">×</button></td>`;
    body.appendChild(tr);
  });
  $$('#tk-body .del').forEach(btn => btn.addEventListener('click', () => {
    saveTickets(getTickets().filter(t => String(t.id) !== btn.dataset.id));
    renderTickets();
  }));
  renderTicketStats();
}
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function initTickets() {
  $('#tk-date').value = fmtISO(latestDrawOnOrBefore(new Date()));
  $('#tk-type').addEventListener('change', e => { $('#tk-number').maxLength = TYPE_MAXLEN[e.target.value]; });
  $('#tk-number').maxLength = TYPE_MAXLEN.back2;
  $('#btn-add-ticket').addEventListener('click', () => {
    const date = $('#tk-date').value;
    const type = $('#tk-type').value;
    const number = onlyDigits($('#tk-number').value);
    const amount = $('#tk-amount').value ? Number($('#tk-amount').value) : null;
    if (!date) return alert('กรุณาเลือกงวดวันที่');
    if (number.length !== TYPE_MAXLEN[type]) return alert(`เลขต้องมี ${TYPE_MAXLEN[type]} หลัก`);
    const list = getTickets();
    list.push({ id: Date.now() + '-' + Math.random().toString(36).slice(2, 7), date, type, number, amount });
    saveTickets(list);
    $('#tk-number').value = '';
    renderTickets();
  });
  $('#btn-export').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(getTickets(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'lotto-tickets.json'; a.click();
    URL.revokeObjectURL(a.href);
  });
  $('#import-file').addEventListener('change', async e => {
    const file = e.target.files[0]; if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data)) throw new Error('รูปแบบไฟล์ไม่ถูกต้อง');
      const merged = [...getTickets(), ...data.filter(d => d && d.date && d.type && d.number)];
      saveTickets(merged); renderTickets();
      alert('นำเข้าสำเร็จ');
    } catch (err) { alert('นำเข้าไฟล์ไม่สำเร็จ: ' + err.message); }
    e.target.value = '';
  });
}

/* ---------- render: ประวัติผลรางวัล ---------- */
function renderHistory() {
  HISTORY = historyFromCache();
  const body = $('#hist-body'); body.innerHTML = '';
  [...HISTORY].reverse().forEach(d => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${fmtTH(d.date)}</td><td class="num">${esc(d.prizeFirst || '-')}</td>
      <td class="num">${esc((d.front3 || []).join(', ') || '-')}</td>
      <td class="num">${esc((d.back3 || []).join(', ') || '-')}</td>
      <td class="num">${esc(d.back2 || '-')}</td>`;
    body.appendChild(tr);
  });
  setStatus('#hist-status', HISTORY.length ? `มีข้อมูล ${HISTORY.length} งวด` : 'ยังไม่มีข้อมูล — กรอกผลรางวัลด้วยตนเองด้านบน');
  renderTickets();
  renderExtraStats();
  populateEnrichDates();
  renderForecast();
}

/* ---------- สถิติเลขท้าย 2 ตัวเพิ่มเติม: คู่/คี่, สูง/ต่ำ, ผลรวม ---------- */
function renderExtraStats() {
  const vals = HISTORY.map(d => d.back2).filter(Boolean);
  const total = vals.length;
  let odd = 0, low = 0;
  vals.forEach(v => { const n = parseInt(v, 10); if (n % 2 === 1) odd++; if (n < 50) low++; });
  const even = total - odd, high = total - low;
  const pct = n => total ? Math.round(n / total * 1000) / 10 + '%' : '-';
  $('#parity-stats').innerHTML = [
    { v: total ? `${odd} / ${even}` : '-', l: 'เลขคี่ / เลขคู่' },
    { v: pct(odd), l: '% เลขคี่' },
    { v: total ? `${low} / ${high}` : '-', l: 'ต่ำ(00-49) / สูง(50-99)' },
    { v: pct(low), l: '% เลขต่ำ' },
  ].map(t => `<div class="stat-tile"><div class="v">${esc(t.v)}</div><div class="l">${t.l}</div></div>`).join('');

  const counts = Array(19).fill(0);
  vals.forEach(v => { counts[+v[0] + +v[1]]++; });
  const max = Math.max(1, ...counts);
  $('#sum-bars').innerHTML = counts.map((c, s) => `
    <div class="bar-wrap" title="ผลรวม ${s}: ออก ${c} ครั้ง">
      ${c ? `<div class="cnt">${c}</div>` : ''}
      <div class="bar" style="height:${c ? Math.max(4, c / max * 100) : 2}%"></div>
      <small>${s}</small>
    </div>`).join('');
}

function initHistory() {
  $('#btn-refresh-latest').addEventListener('click', async () => {
    setStatus('#hist-status', 'กำลังดึง…');
    try { await fetchLatestDraw(); renderHistory(); renderIndicators(); }
    catch (e) { setStatus('#hist-status', 'ดึงไม่สำเร็จ: ' + e.message); }
  });
  $('#btn-load-more').addEventListener('click', async () => {
    setStatus('#hist-status', 'กำลังโหลดย้อนหลังเพิ่ม…');
    const oldest = HISTORY.length ? new Date(HISTORY[0].date + 'T00:00') : new Date();
    const start = HISTORY.length ? prevDrawDate(oldest) : latestDrawOnOrBefore(new Date());
    const dates = drawSeries(8, start);
    let ok = 0;
    for (const d of dates) { try { await fetchDrawByDate(d); ok++; renderHistory(); } catch (e) {} }
    setStatus('#hist-status', ok ? `โหลดเพิ่ม ${ok} งวด (รวม ${HISTORY.length} งวด)` : 'ไม่พบข้อมูลเพิ่มเติม (อาจเก่ากว่าที่ API มี หรือดึงไม่สำเร็จ)');
    renderIndicators();
  });
  $('#btn-manual-add').addEventListener('click', () => {
    const date = $('#man-date').value;
    if (!date) return alert('กรุณาเลือกงวดวันที่');
    const draw = {
      date,
      prizeFirst: onlyDigits($('#man-p1').value) || null,
      front3: $('#man-f3').value.split(',').map(s => onlyDigits(s)).filter(s => s.length === 3),
      back3: $('#man-b3').value.split(',').map(s => onlyDigits(s)).filter(s => s.length === 3),
      back2: onlyDigits($('#man-b2').value) || null,
    };
    const cache = readJSON(LS.cache, {}); cache[date] = draw; writeJSON(LS.cache, cache);
    ['#man-date', '#man-p1', '#man-f3', '#man-b3', '#man-b2'].forEach(s => $(s).value = '');
    renderHistory(); renderIndicators();
  });
  $('#btn-hist-export').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(Object.values(readJSON(LS.cache, {})), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'lotto-results.json'; a.click();
    URL.revokeObjectURL(a.href);
  });
  $('#hist-import-file').addEventListener('change', async e => {
    const file = e.target.files[0]; if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data)) throw new Error('รูปแบบไฟล์ไม่ถูกต้อง (ต้องเป็น array)');
      const cache = readJSON(LS.cache, {});
      let n = 0;
      data.forEach(d => {
        if (!d || !d.date) return;
        cache[d.date] = {
          date: d.date,
          prizeFirst: d.prizeFirst || null,
          front3: Array.isArray(d.front3) ? d.front3 : [],
          back3: Array.isArray(d.back3) ? d.back3 : [],
          back2: d.back2 || null,
        };
        n++;
      });
      writeJSON(LS.cache, cache);
      renderHistory(); renderIndicators();
      alert(`นำเข้าสำเร็จ ${n} งวด`);
    } catch (err) { alert('นำเข้าไฟล์ไม่สำเร็จ: ' + err.message); }
    e.target.value = '';
  });
}

/* ---------- พยากรณ์รางวัลที่ 1: โมเดลความถี่รายหลัก (pool หลายรางวัลเข้าด้วยกัน) ---------- */
function pooledPrizeNumbers(draw, opts) {
  let arr = draw.prizeFirst ? [draw.prizeFirst] : [];
  if (opts.near && Array.isArray(draw.prizeFirstNear)) arr = arr.concat(draw.prizeFirstNear);
  if (opts.p2 && Array.isArray(draw.prize2)) arr = arr.concat(draw.prize2);
  if (opts.p3 && Array.isArray(draw.prize3)) arr = arr.concat(draw.prize3);
  return arr.filter(s => s && s.length === 6);
}
function computePositionalModel(history, opts) {
  const n = history.length;
  const score = Array.from({ length: 6 }, () => Array(10).fill(0));
  history.forEach((draw, i) => {
    const weight = opts.decay ? Math.pow(0.9, n - 1 - i) : 1;
    pooledPrizeNumbers(draw, opts).forEach(numStr => {
      for (let p = 0; p < 6; p++) score[p][+numStr[p]] += weight;
    });
  });
  return score.map(digitScores => {
    const total = digitScores.reduce((a, b) => a + b, 0);
    const list = digitScores.map((s, d) => ({ digit: String(d), score: s, pct: total ? s / total * 100 : 10 }));
    list.sort((a, b) => b.score - a.score || a.digit.localeCompare(b.digit));
    list.forEach((r, idx) => { r.tier = idx < 3 ? 'high' : idx < 7 ? 'mid' : 'low'; });
    return list;
  });
}
function buildTop10(perPos) {
  const highDigits = perPos.map(list => list.filter(r => r.tier === 'high'));
  let combos = [{ digits: [], score: 0 }];
  for (let p = 0; p < 6; p++) {
    const next = [];
    highDigits[p].forEach(r => combos.forEach(c => next.push({ digits: [...c.digits, r.digit], score: c.score + r.pct })));
    combos = next;
  }
  combos.sort((a, b) => b.score - a.score);
  const maxScore = combos[0] ? combos[0].score : 1;
  return combos.slice(0, 10).map(c => ({ number: c.digits.join(''), score: c.score, rel: maxScore ? c.score / maxScore * 100 : 0 }));
}
function renderForecast() {
  const opts = { near: $('#fc-near').checked, p2: $('#fc-p2').checked, p3: $('#fc-p3').checked, decay: $('#fc-decay').checked };
  if (!HISTORY.length) {
    setStatus('#forecast-status', 'ยังไม่มีข้อมูลผลรางวัลให้คำนวณ');
    $('#forecast-pos-grid').innerHTML = ''; $('#forecast-top10').innerHTML = '';
    return;
  }
  const perPos = computePositionalModel(HISTORY, opts);
  const sampleSize = HISTORY.reduce((sum, d) => sum + pooledPrizeNumbers(d, opts).length, 0);
  const latest = new Date(HISTORY[HISTORY.length - 1].date + 'T00:00');
  const target = fmtTH(fmtISO(nextDrawDate(latest)));
  setStatus('#forecast-status', `⏭️ ประมาณการสำหรับงวดถัดไป (${target}) — อิงจาก ${HISTORY.length} งวด (รวม ${sampleSize} ชุดตัวเลข 6 หลักตามตัวเลือกที่ติ๊กไว้)`);
  const labels = ['หลัก 1', 'หลัก 2', 'หลัก 3', 'หลัก 4', 'หลัก 5', 'หลัก 6'];
  $('#forecast-pos-grid').innerHTML = perPos.map((list, i) => `
    <div class="pos-card"><h3>${labels[i]}</h3>
      ${list.slice(0, 4).map(r => `<div class="fc-d"><span><span class="tier ${r.tier}"></span><b>${r.digit}</b></span><small>${r.pct.toFixed(1)}%</small></div>`).join('')}
    </div>`).join('');
  const top10 = buildTop10(perPos);
  $('#forecast-top10').innerHTML = top10.map((c, i) => `
    <div class="top10-row"><span class="rank">#${i + 1}</span><span class="n num">${c.number}</span>
      <span class="bar-track"><span class="bar-fill" style="width:${c.rel}%"></span></span>
      <span class="sc">${c.rel.toFixed(0)}%</span></div>`).join('');
}
function initForecast() {
  ['#fc-near', '#fc-p2', '#fc-p3', '#fc-decay'].forEach(sel => $(sel).addEventListener('change', renderForecast));
}

/* ---------- เพิ่มรางวัลข้างเคียง/รางวัลที่ 2-3 ให้งวดที่มีอยู่แล้ว ---------- */
function populateEnrichDates() {
  const sel = $('#enrich-date'); if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = [...HISTORY].reverse().map(d => `<option value="${d.date}">${fmtTH(d.date)}</option>`).join('');
  if (cur) sel.value = cur;
}
function initEnrich() {
  $('#btn-enrich-save').addEventListener('click', () => {
    const date = $('#enrich-date').value;
    const cache = readJSON(LS.cache, {});
    const draw = cache[date];
    if (!date || !draw) return alert('ยังไม่มีงวดให้เลือก (ต้องกรอกผลรางวัลที่ 1 ของงวดนั้นก่อนในฟอร์มด้านบน)');
    const parseList = (val, len) => val.split(',').map(s => onlyDigits(s)).filter(s => s.length === len);
    draw.prizeFirstNear = parseList($('#enrich-near').value, 6);
    draw.prize2 = parseList($('#enrich-p2').value, 6);
    draw.prize3 = parseList($('#enrich-p3').value, 6);
    cache[date] = draw; writeJSON(LS.cache, cache);
    setStatus('#enrich-status', `บันทึกแล้ว: ข้างเคียง ${draw.prizeFirstNear.length}, รางวัลที่2 ${draw.prize2.length}, รางวัลที่3 ${draw.prize3.length}`);
    renderHistory(); renderForecast();
  });
}

/* ---------- render: ตัวชี้วัด ---------- */
let currentTab = 'back2';
function renderIndicators() {
  const panel = $('#indicator-panel');
  if (!HISTORY.length) { panel.innerHTML = '<p class="empty">ยังไม่มีข้อมูลผลรางวัลให้วิเคราะห์</p>'; $('#suggest-number').textContent = '--'; return; }

  if (currentTab === 'back2') {
    const cold = computeValueOverdue(HISTORY, EXTRACT.back2, BACK2_SPACE);
    const hot = [...cold].sort((a, b) => b.freq - a.freq || a.gap - b.gap);
    const chip = (r, kind) => `<div class="chip"><b>${r.value}</b><small>${kind === 'cold' ? 'ค้าง ' + r.gap : 'ออก ' + r.freq}</small></div>`;
    panel.innerHTML = `<div class="hc-cols">
      <div class="hc-col"><h3 class="cold"><span class="dot cold"></span>เย็นสุด (ค้างงวด)</h3><div class="chip-list">${cold.slice(0, 8).map(r => chip(r, 'cold')).join('')}</div></div>
      <div class="hc-col"><h3 class="hot"><span class="dot hot"></span>ร้อนสุด (ออกบ่อย)</h3><div class="chip-list">${hot.slice(0, 8).map(r => chip(r, 'hot')).join('')}</div></div>
    </div>`;
    $('#suggest-number').textContent = cold[0].value;
  } else {
    const posCount = POS_COUNT[currentTab];
    const coldPerPos = computeDigitOverdue(HISTORY, EXTRACT[currentTab], posCount);
    const hotPerPos = coldPerPos.map(list => [...list].sort((a, b) => b.freq - a.freq || a.gap - b.gap));
    const labels = POS_LABEL[currentTab];
    panel.innerHTML = `<div class="pos-grid">${coldPerPos.map((cold, i) => { const hot = hotPerPos[i]; return `
      <div class="pos-card"><h3>${labels[i]}</h3>
        <div class="d cold"><span class="dot cold"></span><b>${cold[0].digit}</b><small>ค้าง ${cold[0].gap}</small></div>
        <div class="d hot"><span class="dot hot"></span><b>${hot[0].digit}</b><small>ออก ${hot[0].freq}</small></div>
      </div>`; }).join('')}</div>`;
    $('#suggest-number').textContent = coldPerPos.map(list => list[0].digit).join('');
  }
}
function initIndicatorTabs() {
  $$('.tabs2 button').forEach(btn => btn.addEventListener('click', () => {
    $$('.tabs2 button').forEach(b => b.classList.remove('on'));
    btn.classList.add('on'); currentTab = btn.dataset.tab; renderIndicators();
  }));
}

/* ---------- แถบเมนูล่าง: ไฮไลต์แท็บตามส่วนที่กำลังดู ---------- */
function initBottomNav() {
  if (typeof IntersectionObserver === 'undefined') return;
  const links = $$('.bottom-nav a');
  const map = {};
  links.forEach(a => { map[a.getAttribute('href').slice(1)] = a; });
  const io = new IntersectionObserver(entries => {
    entries.forEach(en => {
      if (!en.isIntersecting) return;
      const a = map[en.target.id]; if (!a) return;
      links.forEach(x => x.classList.remove('on'));
      a.classList.add('on');
    });
  }, { rootMargin: '-40% 0px -50% 0px' });
  Object.keys(map).forEach(id => { const el = document.getElementById(id); if (el) io.observe(el); });
}

/* ---------- boot ---------- */
seedIfEmpty();
initSettings();
initTickets();
initHistory();
initIndicatorTabs();
initForecast();
initEnrich();
initBottomNav();
renderHistory();
renderIndicators();
