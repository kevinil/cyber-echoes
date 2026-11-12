'use strict';

/* ------------------------------------------------------------------ */
/* storage                                                             */
/* ------------------------------------------------------------------ */

const KEY = 'echo.store.v1';
const DEFAULT_SETTINGS = { scale: 1, speed: 24 };

const SAMPLE = {
  title: '送别',
  artist: '李叔同',
  key: 'C',
  text: [
    '# 主歌',
    '[C]长亭外 [G]古道边',
    '[F]芳草碧连 [C]天',
    '[Am]晚风拂柳 [Em]笛声残',
    '[Dm]夕阳山 [G]外山',
    '',
    '# 副歌',
    '[C]天之涯 [G]地之角',
    '[F]知交半零 [C]落',
    '[Am]一壶浊酒 [Em]尽余欢',
    '[Dm]今宵别 [G]梦寒'
  ].join('\n')
};

function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }

function isIOSDevice() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isStandaloneApp() {
  return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}

function makeId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function normalizeSong(s) {
  return {
    id: typeof s.id === 'string' && s.id ? s.id : makeId(),
    title: typeof s.title === 'string' ? s.title : '',
    artist: typeof s.artist === 'string' ? s.artist : '',
    key: typeof s.key === 'string' ? s.key : '',
    text: typeof s.text === 'string' ? s.text : '',
    transpose: Number.isFinite(s.transpose) ? clamp(Math.round(s.transpose), -11, 11) : 0,
    createdAt: Number.isFinite(s.createdAt) ? s.createdAt : Date.now(),
    updatedAt: Number.isFinite(s.updatedAt) ? s.updatedAt : Date.now()
  };
}

function loadStore() {
  const fresh = { songs: [], settings: { ...DEFAULT_SETTINGS }, seeded: false };
  let raw;
  try { raw = localStorage.getItem(KEY); } catch { return fresh; }
  if (!raw) return fresh;
  try {
    const p = JSON.parse(raw);
    const songs = Array.isArray(p.songs) ? p.songs.filter(s => s && typeof s === 'object').map(normalizeSong) : [];
    return {
      songs,
      settings: {
        scale: clamp(Number(p.settings && p.settings.scale) || 1, 0.7, 1.8),
        speed: clamp(Number(p.settings && p.settings.speed) || 24, 4, 80)
      },
      seeded: !!p.seeded
    };
  } catch {
    return fresh;
  }
}

const store = loadStore();

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    toast('存储空间不足,这次改动没有保存');
  }
}

function findSong(id) {
  return store.songs.find(s => s.id === id) || null;
}

if (!store.seeded) {
  const now = Date.now();
  store.songs.push(normalizeSong({ ...SAMPLE, id: makeId(), createdAt: now, updatedAt: now }));
  store.seeded = true;
  persist();
}

/* ------------------------------------------------------------------ */
/* dom helpers                                                         */
/* ------------------------------------------------------------------ */

const $ = (sel, root = document) => root.querySelector(sel);

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

function toast(message) {
  const t = $('#toast');
  t.textContent = message;
  t.hidden = false;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { t.hidden = true; }, 2800);
}

/* ------------------------------------------------------------------ */
/* chordpro rendering                                                  */
/* ------------------------------------------------------------------ */

const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const NOTE_INDEX = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

function shiftNote(letter, accidental, delta, preferFlat) {
  let i = NOTE_INDEX[letter] + (accidental === '#' ? 1 : accidental === 'b' ? -1 : 0) + delta;
  i = ((i % 12) + 12) % 12;
  return (preferFlat ? FLAT_NAMES : SHARP_NAMES)[i];
}

function transposeChord(token, delta, preferFlat) {
  if (!delta) return token;
  const m = /^([A-G])([#b]?)(.*)$/.exec(token);
  if (!m) return token;
  if (!/^[A-Za-z0-9#b°ø()+\-/\s]*$/.test(m[3])) return token;
  const flat = m[2] === 'b' || (!m[2] && preferFlat);
  const rest = m[3].replace(/\/([A-G])([#b]?)/g, (_, letter, acc) => '/' + shiftNote(letter, acc, delta, flat));
  return shiftNote(m[1], m[2], delta, flat) + rest;
}

const UNIT_RE = /[⺀-鿿豈-﫿　-〿＀-￯]|[^\s⺀-鿿豈-﫿　-〿＀-￯]+|\s+/g;

function splitUnits(text) {
  const units = text.match(UNIT_RE);
  return units || [];
}

function renderLine(raw, delta, preferFlat) {
  const line = el('div', 'line');
  const parts = raw.split(/(\[[^\]]*\])/);
  let pending = null;

  const addSegment = (chord, text) => {
    const units = splitUnits(text);
    if (units.length === 0) {
      const hold = el('span', 'u u-hold');
      hold.appendChild(document.createTextNode('​'));
      if (chord != null) hold.appendChild(chordNode(chord, delta, preferFlat));
      line.appendChild(hold);
      return;
    }
    units.forEach((unit, i) => {
      const span = el('span', 'u');
      if (i === 0 && chord != null) span.appendChild(chordNode(chord, delta, preferFlat));
      span.appendChild(document.createTextNode(unit));
      line.appendChild(span);
    });
  };

  for (const part of parts) {
    if (part.startsWith('[') && part.endsWith(']')) {
      if (pending !== null) addSegment(pending, '');
      pending = part.slice(1, -1);
    } else if (part.length || pending !== null) {
      addSegment(pending, part);
      pending = null;
    }
  }
  if (pending !== null) addSegment(pending, '');
  return line;
}

function chordNode(chord, delta, preferFlat) {
  const node = el('span', 'c');
  node.textContent = transposeChord(chord, delta, preferFlat);
  return node;
}

function renderScore(container, text, delta, preferFlat) {
  container.textContent = '';
  if (!text || !text.trim()) {
    container.appendChild(el('p', 'empty-note', '谱面还是空的。'));
    return;
  }
  const frag = document.createDocumentFragment();
  for (const raw of text.split(/\r?\n/)) {
    if (/^\s*#/.test(raw)) {
      frag.appendChild(el('p', 'section', raw.replace(/^\s*#\s*/, '')));
    } else if (!raw.trim()) {
      frag.appendChild(el('div', 'gap'));
    } else {
      frag.appendChild(renderLine(raw, delta, preferFlat));
    }
  }
  container.appendChild(frag);
  fitChords(container);
}

function fitChords(container) {
  const units = container.querySelectorAll('.u');
  for (const unit of units) {
    const chord = unit.firstElementChild;
    if (!chord || !chord.classList.contains('c')) continue;
    const fs = parseFloat(getComputedStyle(unit).fontSize) || 16;
    const chordW = chord.getBoundingClientRect().width;
    const unitW = unit.getBoundingClientRect().width;
    if (chordW + 1 > unitW) {
      unit.style.minWidth = (chordW / fs + 0.06).toFixed(3) + 'em';
    }
  }
}

function firstLine(text) {
  const line = (text || '').split(/\r?\n/).find(l => l.trim() && !/^\s*#/.test(l));
  if (!line) return '';
  return line.replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim().slice(0, 28);
}

/* ------------------------------------------------------------------ */
/* routing                                                             */
/* ------------------------------------------------------------------ */

let currentView = 'library';
let currentSong = null;

function setView(name) {
  currentView = name;
  document.body.dataset.view = name;
  $('#view-library').hidden = name !== 'library';
  $('#view-score').hidden = name !== 'score';
  $('#view-editor').hidden = name !== 'editor';
}

function go(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

function route() {
  if (currentView === 'editor' && editorDirty()) {
    if (!confirm('放弃未保存的改动?')) {
      const target = editId ? '#/edit/' + editId : '#/new';
      history.replaceState(null, '', location.pathname + location.search + target);
      return;
    }
    editorBaseline = null;
  }
  stopScroll();
  const raw = location.hash.replace(/^#\/?/, '');
  const parts = raw.split('/').filter(Boolean);

  if (parts[0] === 's') {
    const song = findSong(parts[1]);
    if (song) { showScore(song); return; }
    go('#/');
    return;
  }
  if (parts[0] === 'edit') {
    const song = findSong(parts[1]);
    if (song) { showEditor(song); return; }
    go('#/');
    return;
  }
  if (parts[0] === 'new') { showEditor(null); return; }
  showLibrary();
}

/* ------------------------------------------------------------------ */
/* library                                                             */
/* ------------------------------------------------------------------ */

function renderLibrary() {
  const list = $('#song-list');
  list.textContent = '';
  const songs = [...store.songs].sort((a, b) => b.updatedAt - a.updatedAt);

  $('#lib-count').textContent = songs.length ? songs.length + ' 首' : '';
  $('#lib-empty').hidden = songs.length > 0;
  $('#lib-hint').hidden = !isIOSDevice() || isStandaloneApp();

  for (const song of songs) {
    const li = el('li', 'song');
    const btn = el('button', 'song-open');
    const shift = song.transpose || 0;
    const shownKey = song.key ? transposeChord(song.key, shift, preferFlatFor(song)) : '';
    btn.type = 'button';
    btn.dataset.id = song.id;
    let label = '打开《' + (song.title || '未命名') + '》';
    if (shift && song.key) label += ',原调 ' + song.key + ',当前 ' + shownKey;
    btn.setAttribute('aria-label', label);

    const main = el('span', 'song-main');
    main.appendChild(el('span', 'song-title', song.title || '未命名'));
    const metaBits = [song.artist, firstLine(song.text)].filter(Boolean);
    if (metaBits.length) main.appendChild(el('span', 'song-meta', metaBits.join('  ')));
    btn.appendChild(main);

    if (shownKey) {
      const badge = el('span', 'key-badge num', shownKey + (shift ? (shift > 0 ? ' +' + shift : ' ' + shift) : ''));
      if (shift) badge.title = '原调 ' + song.key + ',当前 ' + shownKey;
      btn.appendChild(badge);
    }
    li.appendChild(btn);
    list.appendChild(li);
  }

  document.title = '回声 · 吉他和弦谱';
}

function showLibrary() {
  releaseWakeLock();
  setView('library');
  renderLibrary();
  currentSong = null;
}

/* ------------------------------------------------------------------ */
/* score view                                                          */
/* ------------------------------------------------------------------ */

const score = { on: false, raf: 0, last: 0, atEnd: false, pos: 0, lastSet: 0 };

function preferFlatFor(song) {
  return !!(song.key && /b/.test(song.key));
}

function showScore(song) {
  currentSong = song;
  setView('score');
  document.title = (song.title || '未命名') + ' · 回声';

  $('#score-title').textContent = song.title || '未命名';
  $('#score-sub').textContent = song.artist || '';

  const paper = $('#score-paper');
  paper.style.setProperty('--score-scale', String(store.settings.scale));
  renderScore(paper, song.text, song.transpose || 0, preferFlatFor(song));

  updateKeyBadge();
  const scroller = $('#score-scroll');
  scroller.scrollTop = 0;

  $('#speed').value = String(store.settings.speed);
  $('#speed-num').textContent = String(store.settings.speed);
  score.atEnd = false;
  setScrollUI();

  showBars();
  requestWakeLock();
}

function updateKeyBadge() {
  const btn = $('#btn-tr-reset');
  const key = (currentSong && currentSong.key || '').trim();
  const shift = (currentSong && currentSong.transpose) || 0;
  const wrap = $('.transpose');
  if (wrap) wrap.classList.toggle('is-shifted', shift !== 0);
  if (!key) {
    btn.textContent = shift ? (shift > 0 ? '+' + shift : String(shift)) : '原调';
    btn.setAttribute('aria-label', shift ? '已转调 ' + shift + ' 个半音,点按还原' : '还原原调');
    return;
  }
  const shown = transposeChord(key, shift, preferFlatFor(currentSong));
  btn.textContent = shown;
  btn.setAttribute('aria-label', '当前 ' + shown + ',原调 ' + key + ',点按还原');
}

function setTranspose(delta) {
  if (!currentSong) return;
  currentSong.transpose = clamp(delta, -11, 11);
  const paper = $('#score-paper');
  renderScore(paper, currentSong.text, currentSong.transpose, preferFlatFor(currentSong));
  updateKeyBadge();
  persist();
  syncScrollState();
}

function applyScale() {
  const paper = $('#score-paper');
  paper.style.setProperty('--score-scale', String(store.settings.scale));
}

function stepScale(direction) {
  store.settings.scale = clamp(Math.round((store.settings.scale + direction * 0.1) * 10) / 10, 0.7, 1.8);
  applyScale();
  persist();
  syncScrollState();
}

function scrollEl() { return $('#score-scroll'); }

function atBottom() {
  const s = scrollEl();
  return s.scrollTop + s.clientHeight >= s.scrollHeight - 2;
}

function scrollNeeded() {
  const s = scrollEl();
  return s.scrollHeight - s.clientHeight > 4;
}

function syncScrollState() {
  if (currentView !== 'score') return;
  if (score.on && !scrollNeeded()) { stopScroll(); return; }
  setScrollUI();
}

function startScroll() {
  if (!currentSong) return;
  if (!scrollNeeded()) { setScrollUI(); return; }
  const s = scrollEl();
  if (atBottom()) s.scrollTop = 0;
  score.atEnd = false;
  score.pos = s.scrollTop;
  score.lastSet = s.scrollTop;
  score.on = true;
  score.last = performance.now();
  setScrollUI();
  cancelAnimationFrame(score.raf);
  score.raf = requestAnimationFrame(tickScroll);
  scheduleVeil();
}

function tickScroll(now) {
  if (!score.on) return;
  const s = scrollEl();
  const dt = Math.min(64, now - score.last);
  score.last = now;
  if (Math.abs(s.scrollTop - score.lastSet) > 2) score.pos = s.scrollTop;
  score.pos += (store.settings.speed * dt) / 1000;
  s.scrollTop = score.pos;
  score.lastSet = s.scrollTop;
  if (s.scrollTop + s.clientHeight >= s.scrollHeight - 1.5) {
    score.on = false;
    score.atEnd = true;
    setScrollUI();
    releaseVeil();
    return;
  }
  score.raf = requestAnimationFrame(tickScroll);
}

function stopScroll() {
  clearTimeout(veilTimer);
  score.on = false;
  score.atEnd = false;
  cancelAnimationFrame(score.raf);
  setScrollUI();
}

function toggleScroll() {
  if (score.on) { stopScroll(); showBars(); }
  else startScroll();
}

function setScrollUI() {
  if (currentView !== 'score') return;
  const btn = $('#btn-scroll');
  const label = $('#scroll-label');
  const play = $('#ico-play');
  const pause = $('#ico-pause');
  const needed = scrollNeeded();
  btn.disabled = !needed;
  btn.setAttribute('aria-pressed', score.on ? 'true' : 'false');
  play.hidden = score.on;
  pause.hidden = !score.on;
  if (!needed) label.textContent = '无需滚动';
  else if (score.on) label.textContent = '暂停';
  else if (score.atEnd) label.textContent = '重来';
  else label.textContent = '滚动';
}

let veilTimer = 0;

function showBars() {
  clearTimeout(veilTimer);
  $('#score-top').classList.remove('is-veiled');
  $('#transport').classList.remove('is-veiled');
  if (score.on) scheduleVeil();
}

function scheduleVeil() {
  clearTimeout(veilTimer);
  veilTimer = setTimeout(() => {
    if (score.on) {
      $('#score-top').classList.add('is-veiled');
      $('#transport').classList.add('is-veiled');
    }
  }, 3400);
}

function releaseVeil() {
  clearTimeout(veilTimer);
  $('#score-top').classList.remove('is-veiled');
  $('#transport').classList.remove('is-veiled');
}

/* ------------------------------------------------------------------ */
/* wake lock                                                           */
/* ------------------------------------------------------------------ */

let wakeLock = null;

async function requestWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    if (wakeLock) return;
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch {
    wakeLock = null;
  }
}

function releaseWakeLock() {
  if (wakeLock) {
    try { wakeLock.release(); } catch { /* noop */ }
    wakeLock = null;
  }
}

/* ------------------------------------------------------------------ */
/* editor                                                              */
/* ------------------------------------------------------------------ */

const PALETTE = ['C', 'G', 'D', 'A', 'E', 'F', 'B', 'Am', 'Em', 'Dm', 'F#m', 'Bm', 'G7', 'Cadd9', 'G/B', 'N.C.'];
let editId = null;
let previewTimer = 0;
let editorBaseline = null;

function buildPalette() {
  const bar = $('#palette');
  if (bar.childElementCount) return;
  for (const chord of PALETTE) {
    const b = el('button', 'chip num', chord);
    b.type = 'button';
    b.dataset.chord = chord;
    b.setAttribute('aria-label', '插入和弦 ' + chord);
    bar.appendChild(b);
  }
}

function showEditor(song) {
  releaseWakeLock();
  editId = song ? song.id : null;
  setView('editor');
  document.title = (song ? '编辑' : '新建') + ' · 回声';
  $('#editor-h').textContent = song ? '编辑谱' : '新建谱';
  $('#f-title').value = song ? song.title : '';
  $('#f-artist').value = song ? song.artist : '';
  $('#f-key').value = song ? song.key : '';
  $('#f-text').value = song ? song.text : '';
  $('#btn-delete').hidden = !song;
  buildPalette();
  updatePreview(true);
  editorBaseline = readEditor();
  window.scrollTo(0, 0);
  const scroller = $('.editor-scroll');
  if (scroller) scroller.scrollTop = 0;
  setTimeout(() => { if (!song) $('#f-title').focus(); }, 60);
}

function updatePreview(now) {
  clearTimeout(previewTimer);
  const paint = () => {
    const text = $('#f-text').value;
    renderScore($('#editor-preview'), text, 0, false);
  };
  if (now) paint();
  else previewTimer = setTimeout(paint, 160);
}

function readEditor() {
  return {
    title: $('#f-title').value,
    artist: $('#f-artist').value,
    key: $('#f-key').value,
    text: $('#f-text').value
  };
}

function editorDirty() {
  if (!editorBaseline) return false;
  const now = readEditor();
  return now.title !== editorBaseline.title ||
    now.artist !== editorBaseline.artist ||
    now.key !== editorBaseline.key ||
    now.text !== editorBaseline.text;
}

function insertChord(chord) {
  const ta = $('#f-text');
  const start = ta.selectionStart;
  const ins = '[' + chord + ']';
  ta.setRangeText(ins, start, start, 'end');
  ta.focus();
  updatePreview();
}

function saveSong() {
  const title = $('#f-title').value.trim() || '未命名';
  const artist = $('#f-artist').value.trim();
  const key = $('#f-key').value.trim();
  const text = $('#f-text').value.replace(/\r\n/g, '\n');
  if (!text.trim()) {
    toast('谱面还是空的,先写两句吧');
    $('#f-text').focus();
    return;
  }
  const now = Date.now();
  let song;
  if (editId) {
    song = findSong(editId);
    if (!song) { go('#/'); return; }
    song.title = title;
    song.artist = artist;
    song.key = key;
    song.text = text;
    song.updatedAt = now;
  } else {
    song = normalizeSong({ id: makeId(), title, artist, key, text, createdAt: now, updatedAt: now });
    store.songs.push(song);
  }
  persist();
  editorBaseline = null;
  go('#/s/' + song.id);
}

function deleteSong() {
  if (!editId) return;
  const song = findSong(editId);
  if (!song) return;
  if (!confirm('删除《' + (song.title || '未命名') + '》?这一步不能撤销。')) return;
  store.songs = store.songs.filter(s => s.id !== editId);
  persist();
  editorBaseline = null;
  go('#/');
}

/* ------------------------------------------------------------------ */
/* import / export                                                     */
/* ------------------------------------------------------------------ */

async function exportSongs() {
  if (!store.songs.length) { toast('曲库是空的,没有可导出的内容'); return; }
  const payload = {
    app: 'echo',
    version: 1,
    exportedAt: new Date().toISOString(),
    songs: store.songs
  };
  const json = JSON.stringify(payload, null, 2);
  const d = new Date();
  const stamp = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const filename = '回声备份-' + stamp + '.json';

  const isIOS = isIOSDevice();
  if (isIOS && navigator.canShare && window.File) {
    const file = new File([json], filename, { type: 'application/json' });
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: filename });
        toast('备份已导出');
        return;
      } catch (err) {
        if (err && err.name === 'AbortError') return;
      }
    }
  }

  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast('已导出 ' + store.songs.length + ' 首');
}

async function importSongs(file) {
  try {
    const text = await file.text();
    const payload = JSON.parse(text);
    const incoming = Array.isArray(payload) ? payload : (payload && payload.songs);
    if (!Array.isArray(incoming)) throw new Error('bad shape');
    let added = 0;
    for (const raw of incoming) {
      if (!raw || typeof raw !== 'object') continue;
      const song = normalizeSong(raw);
      if (findSong(song.id)) song.id = makeId();
      if (!song.text.trim()) continue;
      store.songs.push(song);
      added++;
    }
    store.seeded = true;
    persist();
    renderLibrary();
    toast(added ? '已导入 ' + added + ' 首' : '没有找到可导入的谱子');
  } catch {
    toast('这个文件读不出来,确认是回声的备份 JSON');
  }
}

/* ------------------------------------------------------------------ */
/* events                                                              */
/* ------------------------------------------------------------------ */

function bind() {
  $('#btn-new').addEventListener('click', () => go('#/new'));
  $('#btn-new-empty').addEventListener('click', () => go('#/new'));
  $('#btn-back').addEventListener('click', () => go('#/'));
  $('#btn-edit').addEventListener('click', () => { if (currentSong) go('#/edit/' + currentSong.id); });
  $('#btn-editor-back').addEventListener('click', () => {
    if (editorDirty() && !confirm('放弃未保存的改动?')) return;
    editorBaseline = null;
    if (editId) go('#/s/' + editId);
    else go('#/');
  });
  $('#btn-save').addEventListener('click', saveSong);
  $('#btn-delete').addEventListener('click', deleteSong);
  $('#btn-export').addEventListener('click', exportSongs);
  $('#btn-import').addEventListener('click', () => $('#file-import').click());
  $('#file-import').addEventListener('change', e => {
    const file = e.target.files && e.target.files[0];
    if (file) importSongs(file);
    e.target.value = '';
  });

  $('#song-list').addEventListener('click', e => {
    const btn = e.target.closest('.song-open');
    if (btn && btn.dataset.id) go('#/s/' + btn.dataset.id);
  });

  $('#btn-tr-down').addEventListener('click', () => setTranspose((currentSong.transpose || 0) - 1));
  $('#btn-tr-up').addEventListener('click', () => setTranspose((currentSong.transpose || 0) + 1));
  $('#btn-tr-reset').addEventListener('click', () => setTranspose(0));

  $('#btn-font-down').addEventListener('click', () => stepScale(-1));
  $('#btn-font-up').addEventListener('click', () => stepScale(1));

  const speed = $('#speed');
  speed.addEventListener('input', () => {
    store.settings.speed = clamp(Number(speed.value) || 24, 4, 80);
    $('#speed-num').textContent = String(store.settings.speed);
  });
  speed.addEventListener('change', persist);

  $('#btn-scroll').addEventListener('click', toggleScroll);

  $('#score-scroll').addEventListener('pointerdown', () => {
    if (score.on) stopScroll();
    showBars();
    requestWakeLock();
  });

  $('#transport').addEventListener('pointerdown', showBars);
  $('#score-top').addEventListener('pointerdown', showBars);

  $('#palette').addEventListener('pointerdown', e => {
    if (e.target.closest('.chip')) e.preventDefault();
  });
  $('#palette').addEventListener('click', e => {
    const chip = e.target.closest('.chip');
    if (chip && chip.dataset.chord) insertChord(chip.dataset.chord);
  });
  $('#f-text').addEventListener('input', () => updatePreview());

  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      if (score.on) { stopScroll(); releaseVeil(); }
    } else if (currentView === 'score') {
      requestWakeLock();
    }
  });

  window.addEventListener('beforeunload', e => {
    if (currentView === 'editor' && editorDirty()) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (currentView === 'score') syncScrollState(); }, 150);
  });

  window.addEventListener('hashchange', route);
}

function onKeyDown(e) {
  if (currentView !== 'score' || !currentSong) return;
  const tag = (e.target && e.target.tagName) || '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target && e.target.isContentEditable)) return;

  const s = scrollEl();
  if (e.key === ' ' || e.code === 'Space') {
    e.preventDefault();
    toggleScroll();
    showBars();
  } else if (e.key === 'PageDown') {
    e.preventDefault();
    s.scrollTop += s.clientHeight * 0.82;
    showBars();
  } else if (e.key === 'PageUp') {
    e.preventDefault();
    s.scrollTop -= s.clientHeight * 0.82;
    showBars();
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    s.scrollTop += 48;
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    s.scrollTop -= 48;
  } else if (e.key === 'Home') {
    e.preventDefault();
    s.scrollTop = 0;
  } else if (e.key === 'End') {
    e.preventDefault();
    s.scrollTop = s.scrollHeight;
  }
}

/* ------------------------------------------------------------------ */
/* boot                                                                */
/* ------------------------------------------------------------------ */

bind();
route();

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
