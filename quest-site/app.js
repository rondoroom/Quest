/* parser.js 전역 함수(parseDoc, uid) 사용 */

/* ================= state ================= */
const LS_KEY = 'lifeos.v1';
const LS_UI = 'lifeos.ui';

function blank() { return { v: 1, sections: [], today: [], checks: {} }; }

var S = (() => {
  try { const j = JSON.parse(localStorage.getItem(LS_KEY)); if (j && j.v === 1) return j; } catch (e) {}
  return blank();
})();

var UI = (() => {
  let exp = {}, memo = {};
  try {
    const j = JSON.parse(localStorage.getItem(LS_UI)) || {};
    if (j && j.exp) { exp = j.exp; memo = j.memo || {}; }
    else exp = j; // 구버전 형식 호환
  } catch (e) {}
  return { tab: 'today', open: null, expanded: exp, search: '', selDate: null, viewMon: null, chip: 'todo', listGroup: '', memo, nodeStack: [] };
})();

function save(bump = true) {
  if (bump) S.mtime = Math.max(Date.now(), (S.mtime || 0) + 1); // 기기 간 시계 차이에도 단조증가
  localStorage.setItem(LS_KEY, JSON.stringify(S));
  if (bump) scheduleAutoSync();
}
function saveUI() { localStorage.setItem(LS_UI, JSON.stringify({ exp: UI.expanded, memo: UI.memo })); }

/* ================= 날짜 ================= */
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function shiftDate(s, days) {
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}
const WD = ['일', '월', '화', '수', '목', '금', '토'];
function wdOf(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
}
/* 두 자리 표기: 07월 09일 (수) */
function fmtDate2(s) {
  const [y, m, d] = s.split('-');
  return `${m}월 ${d}일 (${WD[wdOf(s)]})`;
}
function fmtMD(s) { return `${s.slice(5, 7)}/${s.slice(8, 10)}`; }
function pad2(n) { return String(n).padStart(2, '0'); }
function firstUrl(text) { const m = text.match(/https?:\/\/[^\s|]+/); return m ? m[0] : null; }
function mondayOf(s) { return shiftDate(s, -((wdOf(s) + 6) % 7)); }

/* ================= tree helpers ================= */
function walk(nodes, fn, parent = null) {
  for (const n of nodes) { fn(n, parent); if (n.ch && n.ch.length) walk(n.ch, fn, n); }
}
function findNode(id) {
  for (const sec of S.sections) {
    const stack = [{ arr: sec.nodes }];
    while (stack.length) {
      const { arr } = stack.pop();
      for (const n of arr) {
        if (n.id === id) return { node: n, arr, sec };
        if (n.ch && n.ch.length) stack.push({ arr: n.ch });
      }
    }
  }
  return null;
}
function progress(nodes) {
  let done = 0, total = 0;
  walk(nodes, (n) => { if (n.st) { total++; if (n.st === 'd') done++; } });
  return { done, total };
}
function sectionCats(sec) {
  const set = [];
  walk(sec.nodes, (n) => { if (n.cat && !set.includes(n.cat)) set.push(n.cat); });
  return set;
}
const CAT_HUES = [42, 205, 155, 0, 265, 22, 320, 180];
function catColor(name) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return CAT_HUES[h % CAT_HUES.length];
}
function groupByCat(arr) {
  const out = [], used = new Set();
  for (let i = 0; i < arr.length; i++) {
    if (used.has(i)) continue;
    out.push(arr[i]); used.add(i);
    const c = arr[i].cat;
    if (c) {
      for (let j = i + 1; j < arr.length; j++) {
        if (!used.has(j) && arr[j].cat === c) { out.push(arr[j]); used.add(j); }
      }
    }
  }
  return out;
}

/* ================= DOM helpers ================= */
const $ = (id) => document.getElementById(id);
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function toast(msg) {
  const t = el('div', 'toast', msg);
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 1700);
}

/* ---------- sheets ---------- */
function closeSheet() { $('overlay').innerHTML = ''; }
function sheet(title, opts) {
  const scrim = el('div', 'scrim');
  scrim.onclick = (e) => { if (e.target === scrim) closeSheet(); };
  const sh = el('div', 'sheet');
  sh.appendChild(el('div', 'grab'));
  if (title) sh.appendChild(el('h2', '', title));
  for (const o of opts) {
    const b = el('button', 'opt' + (o.danger ? ' danger' : ''));
    b.appendChild(el('span', 'oico', o.icon || ''));
    b.appendChild(document.createTextNode(o.label));
    b.onclick = () => { closeSheet(); o.fn(); };
    sh.appendChild(b);
  }
  scrim.appendChild(sh);
  $('overlay').appendChild(scrim);
}
function formSheet(title, fields, submitLabel, onsubmit) {
  const scrim = el('div', 'scrim');
  scrim.onclick = (e) => { if (e.target === scrim) closeSheet(); };
  const sh = el('div', 'sheet');
  sh.appendChild(el('div', 'grab'));
  sh.appendChild(el('h2', '', title));
  const inputs = {};
  for (const f of fields) {
    sh.appendChild(el('label', '', f.label));
    let inp;
    if (f.type === 'textarea') { inp = el('textarea'); if (f.value != null) inp.value = f.value; }
    else if (f.type === 'select') {
      inp = el('select');
      for (const [v, l] of f.options) { const o = el('option', '', l); o.value = v; inp.appendChild(o); }
      if (f.value != null) inp.value = f.value;
    } else if (f.type === 'caldate') {
      /* 달력 팝업으로 날짜 선택 */
      const holder = { value: f.value || todayStr() };
      const btn = el('button', 'datebtn', fmtDate2(holder.value));
      btn.onclick = (e) => {
        e.preventDefault();
        calPopup(holder.value, (v) => { holder.value = v; btn.textContent = fmtDate2(v); });
      };
      sh.appendChild(btn);
      inputs[f.name] = holder;
      if (f.chips) addChips(sh, f.chips, () => {});
      continue;
    } else { inp = el('input'); inp.type = 'text'; if (f.value != null) inp.value = f.value; }
    if (f.placeholder) inp.placeholder = f.placeholder;
    inputs[f.name] = inp;
    sh.appendChild(inp);
    if (f.chips && f.chips.length) addChips(sh, f.chips, (c) => { inp.value = c; });
  }
  const act = el('div', 'actions');
  const cancel = el('button', 'btn-ghost', '취소'); cancel.onclick = closeSheet;
  const ok = el('button', 'btn-primary', submitLabel);
  ok.onclick = () => {
    const vals = {};
    for (const k in inputs) vals[k] = inputs[k].value;
    closeSheet(); onsubmit(vals);
  };
  act.appendChild(cancel); act.appendChild(ok);
  sh.appendChild(act);
  scrim.appendChild(sh);
  $('overlay').appendChild(scrim);
  const first = Object.values(inputs).find((x) => x.tagName === 'INPUT');
  if (first) first.focus();
}
function addChips(parent, chips, onpick) {
  const row = el('div', 'chiprow');
  for (const c of chips) {
    const ch = el('button', 'qchip', c);
    ch.onclick = (e) => { e.preventDefault(); onpick(c); };
    row.appendChild(ch);
  }
  parent.appendChild(row);
}
function confirmSheet(msg, fn) {
  sheet(msg, [
    { icon: '⚠', label: '확인', danger: true, fn },
    { icon: '', label: '취소', fn: () => {} },
  ]);
}

/* ---------- 달력 팝업 (정중앙) ---------- */
function calPopup(sel, onPick) {
  let [vy, vm] = [Number(sel.slice(0, 4)), Number(sel.slice(5, 7))]; // 보고있는 년/월
  const scrim = el('div', 'scrim center');
  scrim.onclick = (e) => { if (e.target === scrim) scrim.remove(); };
  const pop = el('div', 'calpop');
  scrim.appendChild(pop);
  $('overlay').appendChild(scrim);

  function draw() {
    pop.innerHTML = '';
    const head = el('div', 'calhead');
    const prev = el('button', '', '‹');
    prev.onclick = () => { vm--; if (vm < 1) { vm = 12; vy--; } draw(); };
    const next = el('button', '', '›');
    next.onclick = () => { vm++; if (vm > 12) { vm = 1; vy++; } draw(); };
    head.appendChild(prev);
    head.appendChild(el('div', 'cm', `${vy}년 ${String(vm).padStart(2, '0')}월`));
    head.appendChild(next);
    pop.appendChild(head);

    const wd = el('div', 'calwd');
    for (const w of WD) wd.appendChild(el('span', '', w));
    pop.appendChild(wd);

    const first = new Date(vy, vm - 1, 1);
    const start = first.getDay(); // 일요일 시작
    const days = new Date(vy, vm, 0).getDate();
    const prevDays = new Date(vy, vm - 1, 0).getDate();
    const td = todayStr();
    let row = el('div', 'calrow');
    let cells = 0;
    const cell = (y, m, d, out) => {
      const ds = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const b = el('button', 'calday' + (out ? ' out' : '') + (ds === td ? ' today' : '') + (ds === sel ? ' sel' : ''), String(d));
      b.onclick = () => { scrim.remove(); onPick(ds); };
      row.appendChild(b);
      if (++cells % 7 === 0) { pop.appendChild(row); row = el('div', 'calrow'); }
    };
    for (let i = start - 1; i >= 0; i--) {
      const pm = vm === 1 ? 12 : vm - 1, py = vm === 1 ? vy - 1 : vy;
      cell(py, pm, prevDays - i, true);
    }
    for (let d = 1; d <= days; d++) cell(vy, vm, d, false);
    let nd = 1;
    while (cells % 7 !== 0) {
      const nm = vm === 12 ? 1 : vm + 1, ny = vm === 12 ? vy + 1 : vy;
      cell(ny, nm, nd++, true);
    }
    if (row.children.length) pop.appendChild(row);

    const foot = el('div', 'calfoot');
    const tbtn = el('button', 'go', '오늘');
    tbtn.onclick = () => { scrim.remove(); onPick(todayStr()); };
    const cbtn = el('button', '', '닫기');
    cbtn.onclick = () => scrim.remove();
    foot.appendChild(tbtn); foot.appendChild(cbtn);
    pop.appendChild(foot);
  }
  draw();
}

/* ================= 레벨 시스템 ================= */
function levelNodesOf(sec) { return sec.nodes.filter((n) => n.lv); }
function levelComplete(n) {
  const p = progress([n]);
  return p.total > 0 && p.done === p.total;
}
/* 이전 레벨이 미완이면 잠김 */
function levelLockedIn(sec, lvNode) {
  return sec.nodes.some((x) => x.lv && x.lv < lvNode.lv && !levelComplete(x));
}
function nodePath(nodes, id) {
  let out = null;
  (function rec(ns, acc) {
    for (const n of ns) {
      if (n.id === id) { out = [...acc, n]; return true; }
      if (n.ch && n.ch.length && rec(n.ch, [...acc, n])) return true;
    }
    return false;
  })(nodes, []);
  return out || [];
}
/* 체크 시도가 잠긴 레벨 안이면 차단 */
function canToggle(n) {
  const f = findNode(n.id);
  if (!f) return true;
  const path = nodePath(f.sec.nodes, n.id);
  const lvNode = path.find((x) => x.lv);
  if (lvNode && levelLockedIn(f.sec, lvNode)) {
    toast(`🔒 레벨 ${pad2(lvNode.lv)} 은 이전 레벨을 모두 완료해야 열립니다`);
    return false;
  }
  return true;
}

/* ================= mutations ================= */
function mut(fn) { fn(); save(); render(); }

function setStDeep(n, st) {
  if (n.st) {
    n.st = st;
    for (const t of S.today) if (t.src === n.id) t.done = st === 'd';
  }
  for (const c of n.ch || []) setStDeep(c, st);
}
function toggleNode(n) {
  if (!canToggle(n)) return;
  mut(() => {
    const target = n.st === 'd' ? 'o' : 'd';
    // 자신 + 하위 전체 전파
    setStDeep(n, target);
    // 상위: 하위가 전부 완료면 자동 체크, 아니면 해제
    const f = findNode(n.id);
    if (f) {
      const path = nodePath(f.sec.nodes, n.id);
      for (let i = path.length - 2; i >= 0; i--) {
        const a = path[i];
        if (!a.st) continue;
        const p = progress(a.ch);
        const st2 = (p.total > 0 && p.done === p.total) ? 'd' : 'o';
        if (a.st !== st2) {
          a.st = st2;
          for (const t of S.today) if (t.src === a.id) t.done = st2 === 'd';
        }
      }
    }
  });
}
function toggleTask(t) {
  if (t.src) { const f = findNode(t.src); if (f && !canToggle(f.node)) return; }
  UI.keep = UI.keep || {};
  UI.keep[t.id] = true; // 이 화면에 남겨두기 (밀린 일 체크 시 사라짐 방지)
  mut(() => {
    t.done = !t.done;
    if (t.src) { const f = findNode(t.src); if (f && f.node.st) f.node.st = t.done ? 'd' : 'o'; }
  });
}
function sendToToday(n) {
  const dup = S.today.find((t) => t.src === n.id && !t.done);
  if (dup) { toast('이미 할 일 목록에 있는 항목'); return; }
  const f = findNode(n.id);
  mut(() => { S.today.push({ id: uid(), text: n.text, date: todayStr(), done: n.st === 'd', src: n.id, gcat: f ? f.sec.id : undefined }); });
  toast('할 일에 추가됨 ☖');
}

/* ================= 드래그 공통 ================= */
let dragActive = false;
document.addEventListener('touchmove', (e) => { if (dragActive) e.preventDefault(); }, { passive: false });

/* 플랫 리스트 재정렬 (할 일) — 라이브 DOM 이동 후 순서 커밋 */
function listDragSession(rowEl, container, pointerId, commit) {
  dragActive = true;
  rowEl.classList.add('dragging');
  try { rowEl.setPointerCapture(pointerId); } catch (e) {}
  let moved = false;
  const onMove = (ev) => {
    const over = document.elementsFromPoint(ev.clientX, ev.clientY)
      .find((x) => x !== rowEl && x.parentElement === container && x.dataset && x.dataset.did);
    if (!over) return;
    const r = over.getBoundingClientRect();
    if (ev.clientY < r.top + r.height / 2) container.insertBefore(rowEl, over);
    else container.insertBefore(rowEl, over.nextSibling);
    moved = true;
  };
  const onUp = () => {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', onUp);
    rowEl.classList.remove('dragging');
    dragActive = false;
    if (moved) {
      const order = [...container.children].filter((x) => x.dataset && x.dataset.did).map((x) => x.dataset.did);
      commit(order);
    }
  };
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
  document.addEventListener('pointercancel', onUp);
}
function reorderWithin(arr, ids) {
  const items = ids.map((id) => arr.find((x) => x.id === id)).filter(Boolean);
  const set = new Set(ids);
  let k = 0;
  for (let i = 0; i < arr.length; i++) {
    if (set.has(arr[i].id)) arr[i] = items[k++];
  }
}
/* 롱프레스 + 핸들로 드래그 시작 */
function attachListDrag(rowEl, container, commit) {
  const handle = rowEl.querySelector('.handle');
  if (handle) handle.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation();
    listDragSession(rowEl, container, e.pointerId, commit);
  });
  let timer = null, sx = 0, sy = 0;
  rowEl.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    sx = e.clientX; sy = e.clientY;
    timer = setTimeout(() => {
      timer = null;
      rowEl.dataset.suppress = '1';
      listDragSession(rowEl, container, e.pointerId, commit);
    }, 320);
  });
  const cancel = (e) => {
    if (timer && e && Math.hypot(e.clientX - sx, e.clientY - sy) < 10) return;
    clearTimeout(timer); timer = null;
  };
  rowEl.addEventListener('pointermove', cancel);
  rowEl.addEventListener('pointerup', () => { clearTimeout(timer); timer = null; });
  rowEl.addEventListener('pointercancel', () => { clearTimeout(timer); timer = null; });
}

/* 트리 드래그 — 위/아래 가장자리: 순서, 중앙: 하위로 들여쓰기 */
function treeDragSession(rowEl, pointerId) {
  dragActive = true;
  rowEl.classList.add('dragging');
  try { rowEl.setPointerCapture(pointerId); } catch (e) {}
  let target = null, mode = null;
  const clear = () => {
    document.querySelectorAll('.drop-into,.drop-before,.drop-after')
      .forEach((x) => x.classList.remove('drop-into', 'drop-before', 'drop-after'));
  };
  const onMove = (ev) => {
    clear();
    const over = document.elementsFromPoint(ev.clientX, ev.clientY)
      .find((x) => x !== rowEl && x.classList && x.classList.contains('nrow') && x.dataset.did);
    target = null; mode = null;
    if (!over) return;
    const r = over.getBoundingClientRect();
    const y = (ev.clientY - r.top) / r.height;
    if (y < 0.3) mode = 'before';
    else if (y > 0.7) mode = 'after';
    else mode = 'into';
    target = over.dataset.did;
    over.classList.add(mode === 'into' ? 'drop-into' : mode === 'before' ? 'drop-before' : 'drop-after');
  };
  const onUp = () => {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', onUp);
    rowEl.classList.remove('dragging');
    clear();
    dragActive = false;
    if (target && mode) moveNode(rowEl.dataset.did, target, mode);
  };
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
  document.addEventListener('pointercancel', onUp);
}
/* 노드 이동 커밋: before/after = 형제 재배치(부모 이동 포함), into = 하위로 */
function moveNode(dragId, targetId, mode) {
  if (dragId === targetId) return;
  const d = findNode(dragId);
  if (!d) return;
  let inside = false;
  walk(d.node.ch || [], (n) => { if (n.id === targetId) inside = true; });
  if (inside) { toast('자기 하위 항목으로는 이동 불가'); return; }
  const t = findNode(targetId);
  if (!t) return;
  mut(() => {
    d.arr.splice(d.arr.indexOf(d.node), 1);
    if (mode === 'into') {
      t.node.ch = t.node.ch || [];
      t.node.ch.push(d.node);
      UI.expanded[t.node.id] = true; saveUI();
    } else {
      const idx = t.arr.indexOf(t.node) + (mode === 'after' ? 1 : 0);
      t.arr.splice(idx, 0, d.node);
    }
  });
}
function attachTreeDrag(rowEl) {
  const handle = rowEl.querySelector('.handle');
  if (handle) handle.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation();
    treeDragSession(rowEl, e.pointerId);
  });
  let timer = null, sx = 0, sy = 0;
  rowEl.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    sx = e.clientX; sy = e.clientY;
    timer = setTimeout(() => {
      timer = null;
      rowEl.dataset.suppress = '1';
      treeDragSession(rowEl, e.pointerId);
    }, 320);
  });
  rowEl.addEventListener('pointermove', (e) => {
    if (timer && Math.hypot(e.clientX - sx, e.clientY - sy) >= 10) { clearTimeout(timer); timer = null; }
  });
  rowEl.addEventListener('pointerup', () => { clearTimeout(timer); timer = null; });
  rowEl.addEventListener('pointercancel', () => { clearTimeout(timer); timer = null; });
}
function suppressed(rowEl) {
  if (rowEl.dataset.suppress) { delete rowEl.dataset.suppress; return true; }
  return false;
}

/* 롱프레스 → 메뉴 (버튼 제외, 이동 시 취소) */
function attachLongPress(elm, fn) {
  let timer = null, sx = 0, sy = 0;
  elm.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    sx = e.clientX; sy = e.clientY;
    timer = setTimeout(() => { timer = null; elm.dataset.suppress = '1'; fn(); }, 430);
  });
  elm.addEventListener('pointermove', (e) => {
    if (timer && Math.hypot(e.clientX - sx, e.clientY - sy) > 10) { clearTimeout(timer); timer = null; }
  });
  elm.addEventListener('pointerup', () => { clearTimeout(timer); timer = null; });
  elm.addEventListener('pointercancel', () => { clearTimeout(timer); timer = null; });
}

/* ================= render ================= */
function render() { renderHeader(); renderMain(); renderNav(); }

const ICONS = {
  today: '<svg viewBox="0 0 24 24"><rect x="3.5" y="3.5" width="17" height="17" rx="5"/><path d="M8.5 12.2l2.6 2.6 4.6-5.4"/></svg>',
  goal: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.5"/></svg>',
  list: '<svg viewBox="0 0 24 24"><path d="M6 3.5h12v17l-6-3.6-6 3.6z"/></svg>',
  settings: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4.5 20c1.6-3.8 5.3-5 7.5-5s5.9 1.2 7.5 5"/></svg>',
  routine: '<svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4v5h-5"/></svg>',
};
const TABS = [
  ['today', '할 일'],
  ['routine', '루틴'],
  ['goal', '목표'],
  ['list', '경험노트'],
  ['settings', '설정'],
];

function renderHeader() {
  const h = $('hdr'); h.innerHTML = '';
  if (UI.open && UI.nodeStack.length) {
    const sec = S.sections.find((x) => x.id === UI.open);
    const f = findNode(UI.nodeStack[UI.nodeStack.length - 1]);
    if (!sec || !f) { UI.nodeStack = []; return renderHeader(); }
    const back = el('button', 'back', '‹');
    back.onclick = () => { UI.nodeStack.pop(); render(); };
    h.appendChild(back);
    const wrap = el('div', 'hwrap sec');
    wrap.appendChild(el('h1', '', f.node.text));
    const p = progress(f.node.ch || []);
    wrap.appendChild(el('div', 'sub', sec.title + (p.total ? ` · ${p.done}/${p.total}` : '')));
    h.appendChild(wrap);
    const menu = el('button', 'hbtn', '⋯');
    menu.onclick = () => nodeMenu(f.node, f.arr, sec);
    h.appendChild(menu);
    return;
  }
  if (UI.open) {
    const sec = S.sections.find((s) => s.id === UI.open);
    const back = el('button', 'back', '‹');
    back.onclick = () => { UI.open = null; UI.search = ''; UI.nodeStack = []; render(); };
    h.appendChild(back);
    const wrap = el('div', 'hwrap sec');
    const p = progress(sec.nodes);
    wrap.appendChild(el('h1', '', sec.title));
    wrap.appendChild(el('div', 'sub', p.total ? `${p.done} / ${p.total} · ${Math.round((p.done / p.total) * 100)}%` : '체크 항목 없음'));
    h.appendChild(wrap);
    const menu = el('button', 'hbtn', '⋯');
    menu.onclick = () => sectionMenu(sec);
    h.appendChild(menu);
  } else {
    const t = TABS.find((x) => x[0] === UI.tab);
    const wrap = el('div', 'hwrap');
    wrap.appendChild(el('h1', '', t ? t[1] : ''));
    if (UI.tab === 'today' || UI.tab === 'routine') wrap.appendChild(el('div', 'sub', fmtDate2(UI.selDate || todayStr()) + ((UI.selDate || todayStr()) === todayStr() ? ' · 오늘' : '')));
    h.appendChild(wrap);
  }
}

function renderNav() {
  const n = $('nav'); n.innerHTML = '';
  for (const [id, label] of TABS) {
    const b = el('button', UI.tab === id && !UI.open ? 'on' : '');
    b.innerHTML = ICONS[id];
    b.appendChild(el('span', '', label));
    b.onclick = () => {
      const from = TABS.findIndex((x) => x[0] === UI.tab);
      const to = TABS.findIndex((x) => x[0] === id);
      const dir = to > from ? 'slide-l' : to < from ? 'slide-r' : null;
      UI.tab = id; UI.open = null; UI.search = ''; UI.nodeStack = [];
      render();
      if (dir) {
        const mn = $('main');
        mn.classList.remove('slide-l', 'slide-r');
        void mn.offsetWidth; // 리플로우로 애니메이션 재시작
        mn.classList.add(dir);
        setTimeout(() => mn.classList.remove(dir), 260);
      }
    };
    n.appendChild(b);
  }
}

function renderMain() {
  const m = $('main'); m.innerHTML = '';
  document.querySelectorAll('.fab').forEach((f) => f.remove());
  if (UI.open && UI.nodeStack.length) return renderNodePage(m);
  if (UI.open) return renderTree(m);
  if (UI.tab === 'today') return renderToday(m);
  if (UI.tab === 'routine') return renderRoutineTab(m);
  if (UI.tab === 'goal' || UI.tab === 'list') return renderSections(m, UI.tab);
  if (UI.tab === 'settings') return renderSettings(m);
}

/* ---------- 주간 스트립 (공용, 좌우 스와이프 지원) ---------- */
function weekPane(mon, sel, td) {
  const pane = el('div', 'wpane');
  for (let i = 0; i < 7; i++) {
    const ds = shiftDate(mon, i);
    const b = el('button', 'wday' + (ds === sel ? ' sel' : '') + (ds === td ? ' today' : ''));
    b.appendChild(el('span', 'wd', WD[wdOf(ds)]));
    b.appendChild(el('span', 'dn', String(Number(ds.slice(8)))));
    if (S.today.some((t) => t.date === ds && !t.done)) b.appendChild(el('i', 'dot'));
    b.onclick = () => { UI.selDate = ds; UI.viewMon = mondayOf(ds); render(); };
    pane.appendChild(b);
  }
  return pane;
}

function weekStrip(m) {
  const sel = UI.selDate;
  const td = todayStr();
  if (!UI.viewMon) UI.viewMon = mondayOf(sel);
  const mon = UI.viewMon;

  const week = el('div', 'week');
  const wprev = el('button', 'wnav', '‹');
  week.appendChild(wprev);
  const vp = el('div', 'wvp');
  const track = el('div', 'wtrack');
  for (const off of [-7, 0, 7]) track.appendChild(weekPane(shiftDate(mon, off), sel, td));
  track.style.transform = 'translateX(-33.3333%)';
  vp.appendChild(track);
  week.appendChild(vp);
  const wnext = el('button', 'wnav', '›');
  week.appendChild(wnext);
  m.appendChild(week);

  let finished = false;
  const finish = (dir) => {
    if (finished) return; finished = true;
    if (dir) UI.viewMon = shiftDate(mon, dir * 7);
    render();
  };
  const slide = (dir) => {
    track.style.transition = 'transform 0.24s ease';
    track.style.transform = `translateX(${-33.3333 - dir * 33.3333}%)`;
    track.addEventListener('transitionend', () => finish(dir), { once: true });
    setTimeout(() => finish(dir), 320); // WebView 폴백
  };
  wprev.onclick = () => slide(-1);
  wnext.onclick = () => slide(1);

  // 손가락 추적 스와이프
  let sx = 0, sy = 0, dragging = false, dragged = false;
  vp.addEventListener('pointerdown', (e) => { sx = e.clientX; sy = e.clientY; dragging = true; dragged = false; });
  vp.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (!dragged && Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) dragged = true;
    if (dragged) {
      track.style.transition = 'none';
      track.style.transform = `translateX(calc(-33.3333% + ${dx}px))`;
    }
  });
  const up = (e) => {
    if (!dragging) return; dragging = false;
    if (!dragged) return;
    const dx = e.clientX - sx;
    if (dx < -44) slide(1);
    else if (dx > 44) slide(-1);
    else { track.style.transition = 'transform 0.2s ease'; track.style.transform = 'translateX(-33.3333%)'; }
  };
  vp.addEventListener('pointerup', up);
  vp.addEventListener('pointercancel', up);
  vp.addEventListener('click', (e) => { if (dragged) { e.stopPropagation(); e.preventDefault(); } }, true);

  const bar = el('div', 'toolbar');
  const cal = el('button', 'iconbtn', '📅');
  cal.onclick = () => calPopup(sel, (v) => { UI.selDate = v; UI.viewMon = mondayOf(v); render(); });
  bar.appendChild(cal);
  bar.appendChild(el('div', 'tbdate', fmtDate2(sel)));
  m.appendChild(bar);
}

/* ---------- 할 일 탭 ---------- */
function renderToday(m) {
  if (!UI.selDate) UI.selDate = todayStr();
  weekStrip(m);
  renderTaskList(m, UI.selDate, todayStr());
  fab(() => {
    formSheet('할 일 추가', [
      { name: 'text', label: '내용', placeholder: '무엇을 할까?' },
      { name: 'date', label: '날짜', type: 'caldate', value: UI.selDate },
    ], '추가', (v) => {
      if (!v.text.trim()) return;
      mut(() => S.today.push({ id: uid(), text: v.text.trim(), date: v.date, done: false }));
    });
  });
}

/* ---------- 루틴 탭 (별도) ---------- */
function renderRoutineTab(m) {
  if (!UI.selDate) UI.selDate = todayStr();
  weekStrip(m);
  renderRoutine(m, UI.selDate);
  fab(() => addRoutineSheet());
}

function renderTaskList(m, sel, td) {
  // 선택 날짜의 할 일 + (오늘이면) 밀린 일을 최상단에 합쳐서
  // 선택 날짜보다 이전인데 못 끝낸 일은 어떤 날짜를 보고 있어도 최상단에 이월 표시
  if (UI.keepDate !== sel) { UI.keep = {}; UI.keepDate = sel; } // 날짜 바꾸면 정리
  const keep = UI.keep || {};
  const list = S.today.filter((t) => t.date === sel);
  const overdue = S.today.filter((t) => t.date < sel && (!t.done || keep[t.id]));
  const all = [...overdue, ...list];

  m.appendChild(el('div', 'day-label', (sel === td ? '오늘 할 일' : fmtDate2(sel) + ' 할 일')));
  if (!all.length) {
    const e = el('div', 'empty');
    e.appendChild(el('span', 'glyph', '☖'));
    e.appendChild(document.createTextNode('할 일이 없습니다. + 로 추가하세요.'));
    m.appendChild(e);
    return;
  }
  const box = el('div');
  const undone = all.filter((t) => !t.done);
  const done = all.filter((t) => t.done);
  for (const t of [...undone, ...done]) box.appendChild(taskRow(t, box, td));
  m.appendChild(box);
}

function editTaskSheet(t) {
  formSheet('일정 수정', [
    { name: 'text', label: '내용', value: t.text },
    { name: 'date', label: '날짜', type: 'caldate', value: t.date },
  ], '저장', (v) => mut(() => { t.text = v.text.trim() || t.text; t.date = v.date; }));
}

function taskRow(t, container, td) {
  const r = el('div', 'task' + (t.done ? ' done' : ''));
  r.dataset.did = t.id;

  const f = el('button', 'cbx' + (t.done ? ' d' : ''), '✓');
  f.onclick = (e) => { e.stopPropagation(); toggleTask(t); };
  r.appendChild(f);

  // 이월된 일은 원래 날짜를 좌측에 빨간 칩으로 (선택 날짜 기준)
  const sel = UI.selDate || td;
  if (t.date < sel && !t.done) r.appendChild(el('span', 'chip late', fmtMD(t.date)));
  else if (t.date !== sel) r.appendChild(el('span', 'chip', fmtMD(t.date)));

  // 카테고리 칩: 지정된 목표 카드 (또는 연결 출처)
  const gsec = S.sections.find((x) => x.id === t.gcat) || (t.src && (findNode(t.src) || {}).sec) || null;
  if (gsec) {
    const gc = el('button', 'catchip tk', gsec.title);
    gc.style.setProperty('--h', catColor(gsec.title));
    gc.onclick = (e) => {
      e.stopPropagation();
      UI.tab = gsec.cat === 'list' ? 'list' : gsec.cat === 'routine' ? 'routine' : 'goal';
      UI.open = gsec.id; UI.search = ''; render();
    };
    r.appendChild(gc);
  }

  r.appendChild(el('div', 'txt', t.text));

  const handle = el('button', 'handle', '⠿');
  r.appendChild(handle);
  const more = el('button', 'more', '⋯');
  more.onclick = (e) => { e.stopPropagation(); taskMenu(t); };
  r.appendChild(more);

  attachListDrag(r, container, (order) => mut(() => {
    const undoneIds = order.filter((id) => { const x = S.today.find((y) => y.id === id); return x && !x.done; });
    reorderWithin(S.today, undoneIds);
  }));
  r.onclick = () => { if (!suppressed(r)) editTaskSheet(t); };
  return r;
}

function taskMenu(t) {
  const opts = [
    { icon: '✎', label: '수정', fn: () => editTaskSheet(t) },
    { icon: '→', label: '내일로 미루기', fn: () => mut(() => { t.date = shiftDate(todayStr(), 1); }) },
  ];
  if (t.src) opts.push({ icon: '◎', label: '연결된 목표 열기', fn: () => {
    const f = findNode(t.src);
    if (!f) { toast('원본 항목이 삭제됨'); return; }
    UI.tab = f.sec.cat === 'list' ? 'list' : 'goal';
    UI.open = f.sec.id; UI.search = ''; UI.expanded[f.node.id] = true;
    (function expandPath(nodes, path) {
      for (const n of nodes) {
        if (n.id === t.src) { for (const p of path) UI.expanded[p.id] = true; return true; }
        if (n.ch && expandPath(n.ch, [...path, n])) return true;
      }
      return false;
    })(f.sec.nodes, []);
    saveUI(); render();
  } });
  opts.push({ icon: '🏷', label: t.gcat ? '카테고리 변경/해제' : '카테고리 지정 (목표 카드)', fn: () => {
    const goals = S.sections.filter((x) => x.cat === 'goal');
    sheet('카테고리 — 목표 카드 선택', [
      { icon: '', label: '해제 (없음)', fn: () => mut(() => { delete t.gcat; }) },
      ...goals.map((g) => ({
        icon: t.gcat === g.id ? '✓' : '◎',
        label: g.title,
        fn: () => mut(() => { t.gcat = g.id; }),
      })),
    ]);
  } });
  opts.push({ icon: '✕', label: '삭제', danger: true, fn: () => mut(() => { S.today = S.today.filter((x) => x.id !== t.id); }) });
  sheet(t.text, opts);
}

/* ---------- 루틴 (할 일 화면 통합, 날짜별 체크, 추가/삭제) ---------- */
function ensureRoutineSection() {
  let sec = S.sections.find((s) => s.cat === 'routine');
  if (!sec) { sec = { id: uid(), title: '𝟬𝗕 | 나만의 루틴', cat: 'routine', nodes: [] }; S.sections.push(sec); }
  return sec;
}
function routineGroups() {
  const out = [];
  for (const sec of S.sections.filter((s) => s.cat === 'routine')) {
    const grouped = sec.nodes.length && sec.nodes.every((n) => n.st == null && n.ch);
    if (grouped) {
      for (const g of sec.nodes) {
        const items = [];
        walk(g.ch, (n, p) => { if (n.st != null) items.push({ node: n, arr: (p ? p.ch : g.ch) }); });
        out.push({ sec, gnode: g, title: g.text, items });
      }
    } else {
      const items = [];
      walk(sec.nodes, (n, p) => { if (n.st != null) items.push({ node: n, arr: (p ? p.ch : sec.nodes) }); });
      out.push({ sec, gnode: null, title: sec.title, items });
    }
  }
  return out;
}
function renderRoutine(m, day) {
  if (!S.checks[day]) S.checks[day] = {};
  const checks = S.checks[day];
  const keys = Object.keys(S.checks).sort();
  while (keys.length > 90) delete S.checks[keys.shift()];

  const groups = routineGroups();
  if (!groups.length) {
    const e = el('div', 'empty');
    e.appendChild(el('span', 'glyph', '↻'));
    e.appendChild(document.createTextNode('루틴이 없습니다. + 로 추가하세요.'));
    m.appendChild(e);
    return;
  }
  for (const g of groups) {
    const gv = el('div', 'rgroup');
    const done = g.items.filter((i) => checks[i.node.id]).length;
    const h = el('h3', '', g.title);
    h.appendChild(el('span', 'pct', `${done}/${g.items.length}`));
    const gmenu = el('button', 'more', '⋯');
    gmenu.onclick = () => routineGroupMenu(g);
    h.appendChild(gmenu);
    gv.appendChild(h);
    const box = el('div');
    for (const it of g.items) {
      const on = !!checks[it.node.id];
      const r = el('div', 'task' + (on ? ' done' : ''));
      r.dataset.did = it.node.id;
      const f = el('button', 'cbx' + (on ? ' d' : ''), '✓');
      f.onclick = (e) => { e.stopPropagation(); checks[it.node.id] = !on; if (!checks[it.node.id]) delete checks[it.node.id]; save(); render(); };
      r.appendChild(f);
      r.appendChild(el('div', 'txt', it.node.text));
      const handle = el('button', 'handle', '⠿');
      r.appendChild(handle);
      const more = el('button', 'more', '⋯');
      more.onclick = (e) => { e.stopPropagation(); routineItemMenu(it); };
      r.appendChild(more);
      attachListDrag(r, box, (order) => mut(() => {
        const byArr = new Map();
        for (const id of order) {
          const x = g.items.find((y) => y.node.id === id);
          if (!x) continue;
          if (!byArr.has(x.arr)) byArr.set(x.arr, []);
          byArr.get(x.arr).push(id);
        }
        for (const [arr, ids] of byArr) reorderWithin(arr, ids);
      }));
      r.onclick = () => { if (!suppressed(r)) f.onclick(new Event('click')); };
      box.appendChild(r);
    }
    gv.appendChild(box);
    m.appendChild(gv);
  }
}
function addRoutineSheet() {
  const groups = routineGroups().filter((g) => g.gnode);
  const opts = groups.map((g) => [g.gnode.id, g.title]);
  opts.push(['__new__', '＋ 새 그룹 만들기']);
  formSheet('루틴 추가', [
    { name: 'text', label: '루틴 내용', placeholder: '예: 아침 스트레칭' },
    { name: 'group', label: '그룹', type: 'select', options: opts },
    { name: 'newname', label: '새 그룹 이름 (새 그룹 선택 시)', placeholder: '예: 아침' },
  ], '추가', (v) => {
    if (!v.text.trim()) return;
    mut(() => {
      const sec = ensureRoutineSection();
      let target;
      if (v.group === '__new__') {
        target = { id: uid(), text: (v.newname.trim() || '새 그룹'), st: null, ch: [] };
        sec.nodes.push(target);
      } else {
        const f = findNode(v.group);
        target = f ? f.node : ensureRoutineSection().nodes[0];
      }
      target.ch.push({ id: uid(), text: v.text.trim(), st: 'o', ch: [] });
    });
    toast('루틴 추가됨');
  });
}
function routineItemMenu(it) {
  sheet(it.node.text, [
    { icon: '✎', label: '수정', fn: () => formSheet('루틴 수정', [
      { name: 'text', label: '내용', value: it.node.text },
    ], '저장', (v) => mut(() => { it.node.text = v.text.trim() || it.node.text; })) },
    { icon: '✕', label: '삭제', danger: true, fn: () => confirmSheet(`"${it.node.text}" 루틴 삭제?`, () => mut(() => {
      const i = it.arr.indexOf(it.node); if (i > -1) it.arr.splice(i, 1);
    })) },
  ]);
}
function routineGroupMenu(g) {
  const opts = [];
  if (g.gnode) {
    opts.push({ icon: '✎', label: '그룹 이름 변경', fn: () => formSheet('그룹 이름', [
      { name: 'text', label: '이름', value: g.gnode.text },
    ], '저장', (v) => mut(() => { g.gnode.text = v.text.trim() || g.gnode.text; })) });
    opts.push({ icon: '✕', label: '그룹 삭제 (루틴 포함)', danger: true, fn: () => confirmSheet(`"${g.title}" 그룹 전체 삭제?`, () => mut(() => {
      const i = g.sec.nodes.indexOf(g.gnode); if (i > -1) g.sec.nodes.splice(i, 1);
    })) });
  }
  opts.push({ icon: '＋', label: '이 그룹에 루틴 추가', fn: () => formSheet('루틴 추가', [
    { name: 'text', label: '내용', placeholder: '예: 아침 스트레칭' },
  ], '추가', (v) => {
    if (!v.text.trim()) return;
    mut(() => { (g.gnode ? g.gnode.ch : g.sec.nodes).push({ id: uid(), text: v.text.trim(), st: 'o', ch: [] }); });
  }) });
  sheet(g.title, opts);
}

/* ---------- 섹션 목록 ---------- */
function renderSections(m, cat) {
  let secs = S.sections.filter((s) => s.cat === cat);

  // 경험노트: 제목 바로 아래 카테고리 선택탭
  if (cat === 'list') {
    const gs = [...new Set(secs.map((x) => x.group).filter(Boolean))];
    if (UI.listGroup && !gs.includes(UI.listGroup)) UI.listGroup = '';
    if (gs.length) {
      const chips = el('div', 'chips');
      chips.style.marginBottom = '14px';
      for (const [v, label] of [['', '전체'], ...gs.map((g) => [g, g])]) {
        const c = el('button', 'pchip' + (UI.listGroup === v ? ' on' : ''), label);
        c.onclick = () => { UI.listGroup = v; render(); };
        chips.appendChild(c);
      }
      m.appendChild(chips);
    }
    if (UI.listGroup) secs = secs.filter((x) => x.group === UI.listGroup);
  }
  if (!secs.length) {
    const e = el('div', 'empty');
    e.appendChild(el('span', 'glyph', cat === 'goal' ? '◎' : '≣'));
    e.appendChild(document.createTextNode(cat === 'goal' ? '아직 목표가 없습니다.' : '아직 경험노트가 없습니다.'));
    const b = el('button', '', '텍스트 붙여넣어 가져오기');
    b.onclick = () => importTextSheet(cat);
    e.appendChild(b);
    m.appendChild(e);
  }
  // 그룹(카테고리)별 묶어 보기
  const order = [];
  const byGroup = {};
  for (const sec of secs) {
    const g = sec.group || '';
    if (!(g in byGroup)) { byGroup[g] = []; order.push(g); }
    byGroup[g].push(sec);
  }
  for (const g of order) {
    if (g && !(cat === 'list' && UI.listGroup)) m.appendChild(el('div', 'day-label', g));
    const box = el('div');
    let num = 0;
    for (const sec of byGroup[g]) {
      num++;
      box.appendChild(sectionCard(sec, num, box));
    }
    m.appendChild(box);
  }
  fab(() => sheet('추가', [
    { icon: '＋', label: '새 섹션 만들기', fn: () => formSheet('새 섹션', [
      { name: 'title', label: '제목', placeholder: '예: 05 | 새 목표' },
    ], '만들기', (v) => {
      if (!v.title.trim()) return;
      mut(() => S.sections.push({ id: uid(), title: v.title.trim(), cat, nodes: [] }));
    }) },
    { icon: '📋', label: '텍스트 붙여넣어 가져오기', fn: () => importTextSheet(cat) },
  ]));
}

function sectionCard(sec, num, box) {
  const p = progress(sec.nodes);
  const c = el('div', 'card');
  c.dataset.did = sec.id;
  const row = el('div', 'row');
  row.appendChild(el('span', 'numbadge', String(num)));
  row.appendChild(el('div', 'title', sec.title));
  if (p.total) row.appendChild(el('span', 'pct', `${Math.round((p.done / p.total) * 100)}%`));
  const handle = el('button', 'handle', '⠿');
  row.appendChild(handle);
  c.appendChild(row);
  const bar = el('div', 'bar'); const fill = el('i');
  fill.style.width = p.total ? `${(p.done / p.total) * 100}%` : '0%';
  bar.appendChild(fill); c.appendChild(bar);
  c.appendChild(el('div', 'meta', p.total ? `☗ ${p.done} · ☖ ${p.total - p.done}` : '항목 없음'));
  const commit = (order) => mut(() => reorderWithin(S.sections, order));
  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation();
    listDragSession(c, box, e.pointerId, commit);
  });
  attachLongPress(c, () => sectionMenu(sec));  // 꾹 누르면 그룹 지정 등 서브메뉴
  c.onclick = () => { if (!suppressed(c)) { UI.open = sec.id; UI.search = ''; render(); } };
  return c;
}

/* ---------- 도구 독립 페이지 ---------- */
function renderNodePage(m) {
  const sec = S.sections.find((x) => x.id === UI.open);
  const f = sec && findNode(UI.nodeStack[UI.nodeStack.length - 1]);
  if (!f) { UI.nodeStack = []; return render(); }
  const node = f.node;

  // 배지 줄
  const head = el('div', 'pagehead');
  if (node.lv) head.appendChild(el('span', 'ovbadge lv' + (levelComplete(node) ? ' full' : ''), '레벨 ' + pad2(node.lv)));
  if (node.tool !== undefined) head.appendChild(el('span', 'ovbadge tool', node.tool === 0 ? '임시도구' : '도구 ' + pad2(node.tool)));
  if (node.cat) {
    const c = el('span', 'catchip', node.cat);
    c.style.setProperty('--h', catColor(node.cat));
    head.appendChild(c);
  }
  if (head.children.length) m.appendChild(head);

  // 노드 자체 메모는 항상 표시
  if (node.memo) {
    const mb = el('div', 'memobox page', node.memo);
    mb.onclick = () => memoSheet(node);
    m.appendChild(mb);
  }

  const box = el('div'); box.id = 'treebox';
  m.appendChild(box);
  if (!(node.ch || []).length) {
    const e = el('div', 'empty');
    e.appendChild(el('span', 'glyph', '☖'));
    e.appendChild(document.createTextNode('하위 항목이 없습니다. + 로 추가하세요.'));
    m.appendChild(e);
  } else drawNodes(box, node.ch, 0, sec);

  fab(() => addNodeSheet(node.ch, `"${node.text}" 하위 추가`, sec));
}

/* ---------- 트리 ---------- */
function renderTree(m) {
  const sec = S.sections.find((s) => s.id === UI.open);
  if (!sec) { UI.open = null; return render(); }

  const sb = el('input', 'searchbox');
  sb.placeholder = '검색…'; sb.value = UI.search;
  sb.oninput = () => {
    UI.search = sb.value;
    const box = $('treebox'); box.innerHTML = '';
    drawNodes(box, sec.nodes, 0, sec);
  };
  m.appendChild(sb);

  // 레벨리스트: 섹션 내 레벨 퀘스트 전체 요약
  const lvs = levelNodesOf(sec).slice().sort((a, b) => a.lv - b.lv);
  if (lvs.length) {
    const lb = el('div', 'lvlist');
    lb.appendChild(el('h4', '', '레벨리스트'));
    for (const n of lvs) {
      const locked = levelLockedIn(sec, n);
      const row = el('div', 'lvrow' + (locked ? ' locked' : ''));
      row.appendChild(el('span', 'ovbadge lv' + (levelComplete(n) ? ' full' : ''), (locked ? '🔒 ' : '') + '레벨 ' + pad2(n.lv)));
      row.appendChild(el('div', 'txt', n.text));
      if (levelComplete(n)) row.appendChild(el('span', 'st', '☗'));
      else { const p = progress([n]); if (p.total) row.appendChild(el('span', 'st', `${p.done}/${p.total}`)); }
      row.onclick = () => {
        if (sec.cat === 'list') { UI.nodeStack.push(n.id); render(); return; } // 경험노트: 독립 페이지
        UI.expanded[n.id] = true; saveUI(); render();
        const target = document.querySelector(`.nrow[data-did="${n.id}"]`);
        if (target && target.scrollIntoView) target.scrollIntoView({ behavior: "smooth", block: "start" });
      };
      lb.appendChild(row);
    }
    m.appendChild(lb);
  }

  const box = el('div'); box.id = 'treebox';
  m.appendChild(box);
  drawNodes(box, sec.nodes, 0, sec);

  fab(() => addNodeSheet(sec.nodes, '최상위 항목 추가', sec));
}

function matches(n, q) {
  if (n.text.toLowerCase().includes(q)) return true;
  if (n.cat && n.cat.toLowerCase().includes(q)) return true;
  return (n.ch || []).some((c) => matches(c, q));
}

function drawNodes(container, nodes, depth, sec) {
  const q = UI.search.trim().toLowerCase();
  let num = 0;
  for (const n of groupByCat(nodes)) {
    if (q && !matches(n, q)) continue;
    const isCheck = n.st !== null && n.st !== undefined;
    if (isCheck) num++;
    const isToolPage = n.tool !== undefined && !(UI.nodeStack.length && UI.nodeStack[UI.nodeStack.length - 1] === n.id);
    container.appendChild(nodeRow(n, nodes, depth, sec, isCheck ? num : null));
    if (n.memo && UI.memo[n.id]) {
      const mb = el('div', 'memobox', n.memo);
      mb.onclick = () => memoSheet(n);
      container.appendChild(mb);
    }
    const has = n.ch && n.ch.length && n.tool === undefined && !(n.lv && sec.cat === 'list'); // 도구/경험노트 레벨은 독립 페이지로만
    const open = q ? true : !!UI.expanded[n.id];
    if (has && open) {
      const kids = el('div', 'kids');
      kids.dataset.kids = n.id;
      drawNodes(kids, n.ch, depth + 1, sec);
      container.appendChild(kids);
    }
  }
}

function nodeRow(n, arr, depth, sec, num) {
  const has = n.ch && n.ch.length;
  const isHeader = n.st === null || n.st === undefined;
  const lvLocked = n.lv ? levelLockedIn(sec, n) : false;
  const row = el('div', 'nrow' +
    (isHeader ? ' header' + (depth === 0 ? ' h1' : depth === 1 ? ' h2' : '') : '') +
    (n.st === 'd' ? ' done' : '') + (lvLocked ? ' locked' : ''));
  row.dataset.did = n.id;

  const isToolNode = n.tool !== undefined || (n.lv && sec.cat === 'list'); // 경험노트 레벨도 독립 페이지
  if (isToolNode) {
    row.appendChild(el('span', 'caret pageind', '›'));
  } else {
    const caret = el('button', 'caret' + (has ? (UI.expanded[n.id] ? ' open' : '') : ' leaf'), '▶');
    caret.onclick = (e) => { e.stopPropagation(); UI.expanded[n.id] = !UI.expanded[n.id]; saveUI(); render(); };
    row.appendChild(caret);
  }

  // 넘버박스 = 체크박스 통합: 숫자를 누르면 ✓로 바뀌며 완료 처리
  if (!isHeader && num !== null) {
    const nb = el('button', 'numcheck' + (n.st === 'd' ? ' d' : ''), n.st === 'd' ? '✓' : String(num));
    nb.onclick = (e) => { e.stopPropagation(); toggleNode(n); };
    row.appendChild(nb);
  } else if (num !== null) {
    row.appendChild(el('span', 'numbadge', String(num)));
  } else if (!isHeader) {
    const f = el('button', 'cbx sm' + (n.st === 'd' ? ' d' : ''), '✓');
    f.onclick = (e) => { e.stopPropagation(); toggleNode(n); };
    row.appendChild(f);
  }
  // 레벨/도구 타원 배지
  if (n.lv) row.appendChild(el('span', 'ovbadge lv' + (levelComplete(n) ? ' full' : ''), (lvLocked ? '🔒 ' : '') + '레벨 ' + pad2(n.lv)));
  if (n.tool !== undefined) row.appendChild(el('span', 'ovbadge tool', n.tool === 0 ? '임시도구' : '도구 ' + pad2(n.tool)));
  if (n.cat) {
    const chip = el('span', 'catchip', n.cat);
    chip.style.setProperty('--h', catColor(n.cat));
    row.appendChild(chip);
  }
  // URL은 텍스트에서 분리해 링크 칩으로
  const url = firstUrl(n.text);
  row.appendChild(el('div', 'txt', url ? (n.text.replace(url, '').replace(/\s*\|\s*$/, '').trim() || url) : n.text));
  if (url) {
    const lc = el('button', 'linkchip', '▶ 열기');
    lc.onclick = (e) => { e.stopPropagation(); window.location.href = url; };
    row.appendChild(lc);
  }
  // 다른 카드로의 링크
  if (n.link) {
    const target = S.sections.find((x) => x.id === n.link);
    const lc = el('button', 'linkchip', '↗ ' + (target ? target.title : '링크 없음'));
    lc.onclick = (e) => {
      e.stopPropagation();
      if (!target) { toast('링크 대상이 삭제됨'); return; }
      UI.tab = target.cat === 'list' ? 'list' : target.cat === 'routine' ? 'routine' : 'goal';
      UI.open = target.id; UI.search = ''; render();
    };
    row.appendChild(lc);
  }
  if (n.date) row.appendChild(el('span', 'datechip', fmtMD(n.date)));
  if (has) {
    const p = progress(n.ch);
    if (p.total) row.appendChild(el('span', 'count' + (p.done === p.total ? ' full' : ''), `${p.done}/${p.total}`));
  }

  if (n.memo) {
    const mb = el('button', 'memobtn' + (UI.memo[n.id] ? ' on' : ''), '📝');
    mb.onclick = (e) => { e.stopPropagation(); UI.memo[n.id] = !UI.memo[n.id]; if (!UI.memo[n.id]) delete UI.memo[n.id]; saveUI(); render(); };
    row.appendChild(mb);
  }
  const handle = el('button', 'handle', '⠿');
  row.appendChild(handle);
  const more = el('button', 'more', '⋯');
  more.onclick = (e) => { e.stopPropagation(); nodeMenu(n, arr, sec); };
  row.appendChild(more);

  attachTreeDrag(row);
  row.onclick = () => {
    if (suppressed(row)) return;
    if (isToolNode) { UI.nodeStack.push(n.id); render(); return; }  // 도구 → 독립 페이지
    if (has) { UI.expanded[n.id] = !UI.expanded[n.id]; saveUI(); render(); }
    else if (!isHeader) toggleNode(n);
  };
  return row;
}

function memoSheet(n) {
  formSheet('📝 메모', [
    { name: 'memo', label: '이 항목에 대한 메모 (비우면 삭제)', type: 'textarea', value: n.memo || '', placeholder: '어떤 프로젝트인지, 참고사항, 아이디어…' },
  ], '저장', (v) => mut(() => {
    const t = v.memo.trim();
    if (t) { n.memo = t; UI.memo[n.id] = true; }
    else { delete n.memo; delete UI.memo[n.id]; }
    saveUI();
  }));
}

function addNodeSheet(arr, title, sec) {
  formSheet(title, [
    { name: 'text', label: '내용', placeholder: '항목 내용' },
    { name: 'kind', label: '종류', type: 'select', options: [['o', '☖ 체크 항목'], ['h', '제목(그룹)']] },
    { name: 'cat', label: '카테고리 (선택)', placeholder: '예: 급함, 외주, 아이디어', chips: sec ? sectionCats(sec) : [] },
  ], '추가', (v) => {
    if (!v.text.trim()) return;
    mut(() => {
      const node = { id: uid(), text: v.text.trim(), st: v.kind === 'h' ? null : 'o', ch: [] };
      if (v.cat && v.cat.trim()) node.cat = v.cat.trim();
      arr.push(node);
    });
  });
}

function nodeMenu(n, arr, sec) {
  const isHeader = n.st === null || n.st === undefined;
  const opts = [];
  if (!isHeader) {
    opts.push({ icon: '☖', label: '할 일로 보내기', fn: () => sendToToday(n) });
    opts.push({ icon: n.st === 'd' ? '☖' : '☗', label: n.st === 'd' ? '미완료로 되돌리기' : '완료 처리', fn: () => toggleNode(n) });
  } else {
    opts.push({ icon: '☖', label: '체크 항목으로 전환', fn: () => mut(() => { n.st = 'o'; }) });
  }
  opts.push({ icon: '◎', label: n.lv ? `레벨 변경/해제 (현재 레벨 ${pad2(n.lv)})` : '레벨 지정', fn: () => formSheet('레벨 지정', [
    { name: 'lv', label: '레벨 번호 (1~99, 비우면 해제)', value: n.lv ? String(n.lv) : '', placeholder: '예: 1' },
  ], '저장', (v) => mut(() => {
    const num = parseInt(v.lv, 10);
    if (num >= 1 && num <= 99) n.lv = num; else delete n.lv;
  })) });
  opts.push({ icon: '🔧', label: n.tool !== undefined ? `도구 변경/해제 (현재 ${n.tool === 0 ? '임시도구' : '도구 ' + pad2(n.tool)})` : '도구 지정', fn: () => formSheet('도구 지정', [
    { name: 'tool', label: '도구 번호 (1~99) / "임시" 입력 / 비우면 해제', value: n.tool === 0 ? '임시' : (n.tool ? String(n.tool) : ''), placeholder: '예: 1 또는 임시' },
  ], '저장', (v) => mut(() => {
    const t = v.tool.trim();
    if (t === '임시') n.tool = 0;
    else { const num = parseInt(t, 10); if (num >= 1 && num <= 99) n.tool = num; else delete n.tool; }
  })) });
  opts.push({ icon: '↗', label: n.link ? '링크 변경/해제' : '링크 지정 (다른 카드로 이동)', fn: () => formSheet('링크 지정', [
    { name: 'link', label: '이동할 카드', type: 'select', value: n.link || '', options: [
      ['', '해제 / 없음'],
      ...S.sections.map((x) => [x.id, `[${x.cat === 'goal' ? '목표' : x.cat === 'list' ? '경험노트' : '루틴'}] ${x.title}`]),
    ] },
  ], '저장', (v) => mut(() => { if (v.link) n.link = v.link; else delete n.link; })) });
  opts.push({ icon: '🏷', label: n.cat ? `카테고리 변경 (현재: ${n.cat})` : '카테고리 지정', fn: () => formSheet('카테고리', [
    { name: 'cat', label: '카테고리명 (비우면 해제)', value: n.cat || '', chips: sectionCats(sec) },
  ], '저장', (v) => mut(() => {
    const c = v.cat.trim();
    if (c) n.cat = c; else delete n.cat;
  })) });
  opts.push({ icon: '📝', label: n.memo ? '메모 수정' : '메모 작성', fn: () => memoSheet(n) });
  opts.push({ icon: '＋', label: '하위 항목 추가', fn: () => { UI.expanded[n.id] = true; saveUI(); addNodeSheet(n.ch, `"${n.text}" 하위 추가`, sec); } });
  opts.push({ icon: '✎', label: '수정', fn: () => formSheet('수정', [
    { name: 'text', label: '내용', value: n.text },
  ], '저장', (v) => mut(() => { n.text = v.text.trim() || n.text; })) });
  if (!isHeader) opts.push({ icon: '📅', label: '날짜 지정', fn: () => calPopup(n.date || todayStr(), (v) => mut(() => {
    n.date = v;
    const t = S.today.find((x) => x.src === n.id);
    if (t) t.date = v;
    else S.today.push({ id: uid(), text: n.text, date: v, done: n.st === 'd', src: n.id });
  })) });
  opts.push({ icon: '✕', label: '삭제', danger: true, fn: () => confirmSheet(`"${n.text}" 삭제? 하위 항목도 함께 삭제됩니다.`, () => mut(() => {
    const i = arr.indexOf(n); if (i > -1) arr.splice(i, 1);
    for (const t of S.today) if (t.src === n.id) delete t.src;
  })) });
  sheet(n.text, opts);
}

function sectionMenu(sec) {
  sheet(sec.title, [
    { icon: '✎', label: '섹션 이름 변경', fn: () => formSheet('이름 변경', [
      { name: 'title', label: '제목', value: sec.title },
    ], '저장', (v) => mut(() => { sec.title = v.title.trim() || sec.title; })) },
    { icon: '🗂', label: sec.group ? `그룹 변경 (현재: ${sec.group})` : '그룹 지정 (카드 묶어 보기)', fn: () => formSheet('그룹 지정', [
      { name: 'g', label: '그룹명 (비우면 해제)', value: sec.group || '', chips: [...new Set(S.sections.map((x) => x.group).filter(Boolean))] },
    ], '저장', (v) => { mut(() => { const g = v.g.trim(); if (g) sec.group = g; else delete sec.group; }); }) },
    { icon: '⇄', label: '카테고리 이동 (목표/경험노트/루틴)', fn: () => formSheet('카테고리 이동', [
      { name: 'cat', label: '카테고리', type: 'select', options: [['goal', '목표'], ['list', '경험노트'], ['routine', '루틴']] },
    ], '이동', (v) => { mut(() => { sec.cat = v.cat; }); UI.open = null; render(); }) },
    { icon: '▾', label: '전체 접기', fn: () => { walk(sec.nodes, (n) => { delete UI.expanded[n.id]; }); saveUI(); render(); } },
    { icon: '✕', label: '섹션 삭제', danger: true, fn: () => confirmSheet(`"${sec.title}" 전체 삭제?`, () => {
      mut(() => { S.sections = S.sections.filter((s) => s.id !== sec.id); });
      UI.open = null; render();
    }) },
  ]);
}

/* ================= 동기화 (GitHub Gist, PC ↔ 모바일) ================= */
const SYNC_KEY = 'lifeos.sync';
function syncCfg() { try { return JSON.parse(localStorage.getItem(SYNC_KEY)) || null; } catch (e) { return null; } }
function saveSyncCfg(c) { if (c) localStorage.setItem(SYNC_KEY, JSON.stringify(c)); else localStorage.removeItem(SYNC_KEY); }

async function gh(path, method, token, body) {
  const res = await fetch('https://api.github.com' + path, {
    method: method || 'GET',
    headers: {
      'Authorization': 'token ' + token,
      'Accept': 'application/vnd.github+json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error('GitHub ' + res.status);
  return res.json();
}
function gistBody() {
  return { files: { 'quest-data.json': { content: JSON.stringify(S) } } };
}
async function readRemote(cfg) {
  const g = await gh('/gists/' + cfg.gist, 'GET', cfg.token);
  const f = g.files['quest-data.json'];
  if (!f) throw new Error('quest-data.json 없음');
  let content = f.content;
  if (f.truncated) content = await (await fetch(f.raw_url)).text();
  return JSON.parse(content);
}
async function pushRemote(cfg) {
  await gh('/gists/' + cfg.gist, 'PATCH', cfg.token, gistBody());
  cfg.lastRemote = S.mtime || 0;
  cfg.lastSynced = S.mtime || 0;
  cfg.lastTime = Date.now();
  saveSyncCfg(cfg);
}
function applyRemote(cfg, remote) {
  S = remote;
  if (!S.checks) S.checks = {};
  save(false);
  cfg.lastRemote = S.mtime || 0;
  cfg.lastSynced = S.mtime || 0;
  cfg.lastTime = Date.now();
  saveSyncCfg(cfg);
  render();
}
let syncing = false;
async function syncNow(manual) {
  const cfg = syncCfg();
  if (!cfg || syncing) return;
  syncing = true;
  try {
    const remote = await readRemote(cfg);
    const localChanged = (S.mtime || 0) > (cfg.lastSynced || 0);
    const remoteChanged = (remote.mtime || 0) > (cfg.lastRemote || 0);
    if (remoteChanged && localChanged) {
      if (manual) {
        sheet('⚠ 동기화 충돌 — 양쪽 모두 수정됨', [
          { icon: '☁', label: '원격(다른 기기) 데이터 받기 — 이 기기 변경은 사라짐', fn: () => applyRemote(cfg, remote) },
          { icon: '📱', label: '이 기기 데이터로 덮어쓰기', danger: true, fn: () => pushRemote(cfg).then(() => { toast('업로드 완료'); render(); }).catch((e) => toast('실패: ' + e.message)) },
          { icon: '', label: '취소', fn: () => {} },
        ]);
      } else toast('⚠ 동기화 충돌 — 설정에서 수동 동기화 필요');
    } else if (remoteChanged) {
      applyRemote(cfg, remote);
      if (manual) toast('☁ 원격 데이터 적용 완료');
    } else if (localChanged) {
      await pushRemote(cfg);
      if (manual) toast('☁ 업로드 완료');
      else render();
    } else if (manual) toast('이미 최신 상태');
    if (!manual) render();
  } catch (e) {
    if (manual) toast('동기화 실패: ' + e.message);
  } finally { syncing = false; }
}
/* 주기 동기화: 시트 편집 중이거나 드래그 중엔 건너뜀 (입력 유실 방지) */
function syncTick() {
  if (!syncCfg() || syncing) return;
  if (typeof dragActive !== 'undefined' && dragActive) return;
  const ov = $('overlay');
  if (ov && ov.children.length) return;
  syncNow(false);
}
setInterval(syncTick, 30000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) syncTick(); // 앱으로 돌아올 때 즉시 최신화
});

let autoTimer = null;
function scheduleAutoSync() {
  if (!syncCfg()) return;
  clearTimeout(autoTimer);
  autoTimer = setTimeout(() => syncNow(false), 4000);
}
function syncSetupSheet() {
  formSheet('GitHub 동기화 설정', [
    { name: 'token', label: 'GitHub 토큰 (github.com/settings/tokens → classic, gist 권한)', placeholder: 'ghp_...' },
    { name: 'gist', label: 'Gist ID (비우면 자동 생성 — 다른 기기에선 같은 ID 입력)', placeholder: '선택사항' },
  ], '연결', async (v) => {
    const token = v.token.trim();
    if (!token) { toast('토큰 필요'); return; }
    try {
      let gist = v.gist.trim();
      const cfg = { token, gist, lastRemote: 0, lastSynced: 0 };
      if (!gist) {
        const g = await gh('/gists', 'POST', token, {
          description: 'QUEST app data', public: false,
          files: { 'quest-data.json': { content: JSON.stringify(S) } },
        });
        cfg.gist = g.id;
        cfg.lastRemote = S.mtime || 0; cfg.lastSynced = S.mtime || 0; cfg.lastTime = Date.now();
        saveSyncCfg(cfg);
        toast('연결 완료 — Gist ID: ' + g.id);
      } else {
        saveSyncCfg(cfg);
        await syncNow(true);
      }
      render();
    } catch (e) { toast('연결 실패: ' + e.message); }
  });
}

/* ---------- 폰트 ---------- */
const FONT_GENERIC = [
  ['', '기본 (Freesentation)'],
  ['sans-serif', '고딕 (Sans)'],
  ['sans-serif-light', '고딕 라이트'],
  ['sans-serif-medium', '고딕 미디엄'],
  ['sans-serif-condensed', '고딕 컨덴스드'],
  ['serif', '명조 (Serif)'],
  ['monospace', '고정폭 (Mono)'],
  ['cursive', '필기체'],
];
const FONT_NAMED = ['Noto Sans KR', 'Noto Serif KR', 'Roboto', 'SamsungOneKorean', 'SamsungOneUI', 'One UI Sans KR VF', 'SEC', 'Spoqa Han Sans'];
function fontExists(name) {
  try {
    const c = document.createElement('canvas').getContext('2d');
    const probe = '한글체크Ag19';
    c.font = '17px monospace';
    const w0 = c.measureText(probe).width;
    c.font = `17px "${name}", monospace`;
    return c.measureText(probe).width !== w0;
  } catch (e) { return false; }
}
function currentFont() { return localStorage.getItem('lifeos.font') || ''; }
function applyFont() {
  const f = currentFont();
  document.body.style.fontFamily = f
    ? `"${f.replace(/"/g, '')}", 'Freesentation', system-ui, sans-serif`
    : '';
}
function fontSheet() {
  const cur = currentFont();
  const opts = [];
  const list = [...FONT_GENERIC];
  for (const n of FONT_NAMED) if (fontExists(n)) list.push([n, n]);
  for (const [v, label] of list) {
    opts.push({ icon: cur === v ? '✓' : '', label, fn: () => {
      if (v) localStorage.setItem('lifeos.font', v); else localStorage.removeItem('lifeos.font');
      applyFont(); render();
      toast('폰트 적용: ' + label);
    } });
  }
  sheet('폰트 변경 — 기기에서 인식된 폰트', opts);
}

/* ---------- 설정 ---------- */
function renderSettings(m) {
  const g0 = el('div', 'setgroup');
  g0.appendChild(el('h3', '', '화면'));
  const curLabel = (FONT_GENERIC.find((x) => x[0] === currentFont()) || [null, currentFont()])[1];
  g0.appendChild(setBtn('🔤 폰트 변경', '현재: ' + curLabel, fontSheet));
  m.appendChild(g0);
  const g1 = el('div', 'setgroup');
  g1.appendChild(el('h3', '', '데이터 가져오기'));
  g1.appendChild(setBtn('📋 텍스트 붙여넣어 가져오기', '☖/☗ 형식의 노트를 그대로 붙여넣으면 자동 변환', () => importTextSheet('goal')));
  g1.appendChild(setBtn('📂 JSON 파일 가져오기', '내보낸 백업 파일로 복원 (기존 데이터를 대체)', importJSON));
  g1.appendChild(setBtn('📄 JSON 텍스트로 가져오기', '백업 JSON을 붙여넣어 복원 (전체 교체)', importJSONText));
  g1.appendChild(setBtn('📥 섹션 업데이트 가져오기', '일부 섹션만 교체 — 나머지 진행 상황은 유지', importSectionUpdate));
  g1.appendChild(setBtn('📦 내장 데이터 불러오기', '앱에 포함된 my-data.json이 있으면 복원', () => loadEmbedded(true)));
  m.appendChild(g1);

  const gs = el('div', 'setgroup');
  gs.appendChild(el('h3', '', '동기화 (PC ↔ 모바일)'));
  const cfg = syncCfg();
  if (!cfg) {
    gs.appendChild(setBtn('☁ GitHub로 연동 설정', 'PC와 폰이 같은 데이터를 공유 — 비공개 Gist 사용', syncSetupSheet));
  } else {
    const t = cfg.lastTime ? new Date(cfg.lastTime) : null;
    gs.appendChild(setBtn('☁ 지금 동기화', (t ? `마지막: ${String(t.getMonth()+1).padStart(2,'0')}/${String(t.getDate()).padStart(2,'0')} ${String(t.getHours()).padStart(2,'0')}:${String(t.getMinutes()).padStart(2,'0')} · ` : '') + 'Gist ' + cfg.gist.slice(0, 8) + '… (저장 후 자동 동기화됨)', () => syncNow(true)));
    gs.appendChild(setBtn('Gist ID 보기 / 복사', '다른 기기 연결 시 이 ID 입력: ' + cfg.gist, () => copyFallback(cfg.gist, () => toast('Gist ID 복사됨'))));
    const off = setBtn('연동 해제', '데이터는 유지, 동기화만 중단', () => confirmSheet('동기화 연동을 해제할까요?', () => { saveSyncCfg(null); render(); }));
    off.classList.add('danger');
    gs.appendChild(off);
  }
  m.appendChild(gs);

  const g2 = el('div', 'setgroup');
  g2.appendChild(el('h3', '', '데이터 내보내기'));
  g2.appendChild(setBtn('💾 JSON 백업 내보내기', '파일 저장 또는 클립보드 복사', exportJSON));
  m.appendChild(g2);

  const g3 = el('div', 'setgroup');
  g3.appendChild(el('h3', '', '통계'));
  let tot = 0, don = 0;
  for (const s of S.sections) { const p = progress(s.nodes); tot += p.total; don += p.done; }
  g3.appendChild(setBtn(`☗ ${don} / ☖ ${tot - don} · 전체 ${tot}개 항목`, `섹션 ${S.sections.length}개 · 할 일 ${S.today.length}개`, () => {}));
  m.appendChild(g3);

  const g4 = el('div', 'setgroup');
  g4.appendChild(el('h3', '', '초기화'));
  const del = setBtn('전체 데이터 삭제', '모든 섹션·할 일·루틴 기록 제거', () =>
    confirmSheet('정말 전체 삭제할까요? 되돌릴 수 없습니다.', () => { S = blank(); UI.expanded = {}; save(); saveUI(); render(); }));
  del.classList.add('danger');
  m.appendChild(g4); g4.appendChild(del);
}
function setBtn(title, sub, fn) {
  const b = el('button', 'setbtn');
  b.appendChild(document.createTextNode(title));
  if (sub) b.appendChild(el('small', '', sub));
  b.onclick = fn;
  return b;
}

function importTextSheet(defaultCat) {
  formSheet('텍스트 가져오기', [
    { name: 'title', label: '섹션 제목', placeholder: '예: 01 | 재력' },
    { name: 'cat', label: '카테고리', type: 'select', options: [
      ['goal', '목표'], ['list', '경험노트'], ['routine', '루틴'],
    ].sort((a) => (a[0] === defaultCat ? -1 : 0)) },
    { name: 'text', label: '노트 내용 (☖/☗ 형식 그대로)', type: 'textarea', placeholder: '☖  할 일 1\n☗  끝낸 일\n07/05  날짜 있는 일' },
  ], '가져오기', (v) => {
    if (!v.text.trim()) return;
    const { section, todayTasks } = parseDoc(v.title.trim() || '제목 없음', v.text, v.cat);
    mut(() => { S.sections.push(section); S.today.push(...todayTasks); });
    toast(`"${section.title}" 가져오기 완료`);
  });
}

function applyImported(j, silent) {
  if (!j || !Array.isArray(j.sections)) throw new Error('형식 오류');
  const doIt = () => {
    S = { v: 1, sections: j.sections, today: j.today || [], checks: j.checks || {} };
    UI.expanded = {}; save(); saveUI(); render();
    toast('가져오기 완료');
  };
  if (silent) doIt();
  else confirmSheet(`섹션 ${j.sections.length}개 데이터로 교체할까요? 기존 데이터는 사라집니다.`, doIt);
}

function importJSON() {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = '.json,application/json';
  inp.onchange = () => {
    const file = inp.files[0]; if (!file) return;
    const r = new FileReader();
    r.onload = () => {
      try { applyImported(JSON.parse(r.result)); }
      catch (e) { toast('JSON 파일을 읽을 수 없음: ' + e.message); }
    };
    r.readAsText(file);
  };
  inp.click();
}

/* 섹션 부분 교체: 제목(또는 replaces 지정)이 같은 섹션만 갈아끼우고 나머지는 유지 */
function applySectionUpdate(j) {
  const arr = Array.isArray(j) ? j : j.sections;
  if (!Array.isArray(arr)) throw new Error('형식 오류');
  let replaced = 0, added = 0;
  mut(() => {
    for (const inc of arr) {
      const key = inc.replaces || inc.title;
      delete inc.replaces;
      const idx = S.sections.findIndex((x) => x.title === key || x.title === inc.title);
      if (idx > -1) {
        inc.id = S.sections[idx].id;
        if (!inc.cat) inc.cat = S.sections[idx].cat;
        if (inc.group === undefined && S.sections[idx].group) inc.group = S.sections[idx].group;
        S.sections[idx] = inc;
        replaced++;
      } else {
        if (!inc.cat) inc.cat = 'goal';
        if (!inc.id) inc.id = uid();
        S.sections.push(inc);
        added++;
      }
    }
    // 교체로 끊어진 할 일 링크 정리
    for (const t of S.today) if (t.src && !findNode(t.src)) delete t.src;
  });
  toast(`섹션 업데이트 완료 — 교체 ${replaced} · 추가 ${added}`);
}
function importSectionUpdate() {
  formSheet('섹션 업데이트 (부분 교체)', [
    { name: 'text', label: '업데이트 JSON 붙여넣기 — 같은 제목 섹션만 교체, 나머지 데이터는 유지', type: 'textarea', placeholder: '{"sections":[...]}' },
  ], '적용', (v) => {
    try { applySectionUpdate(JSON.parse(v.text)); }
    catch (e) { toast('JSON을 읽을 수 없음: ' + e.message); }
  });
}

function importJSONText() {
  formSheet('JSON 텍스트 가져오기', [
    { name: 'text', label: '백업 JSON 전체를 붙여넣기', type: 'textarea', placeholder: '{"v":1,"sections":[...]}' },
  ], '가져오기', (v) => {
    try { applyImported(JSON.parse(v.text)); }
    catch (e) { toast('JSON을 읽을 수 없음: ' + e.message); }
  });
}

function loadEmbedded(manual) {
  const x = new XMLHttpRequest();
  x.open('GET', 'my-data.json', true);
  x.onload = () => {
    try {
      const j = JSON.parse(x.responseText);
      if (manual) applyImported(j);
      else sheet('내장 데이터 발견', [
        { icon: '📦', label: `내 데이터 불러오기 (섹션 ${j.sections.length}개)`, fn: () => applyImported(j, true) },
        { icon: '', label: '빈 상태로 시작', fn: () => {} },
      ]);
    } catch (e) { if (manual) toast('내장 데이터 없음'); }
  };
  x.onerror = () => { if (manual) toast('내장 데이터 없음'); };
  try { x.send(); } catch (e) { if (manual) toast('내장 데이터 없음'); }
}

function exportJSON() {
  const json = JSON.stringify(S, null, 1);
  sheet('내보내기', [
    { icon: '📄', label: '전체 텍스트 보기 (복사용, 앱에서 권장)', fn: () => {
      const scrim = el('div', 'scrim');
      scrim.onclick = (e) => { if (e.target === scrim) closeSheet(); };
      const sh = el('div', 'sheet');
      sh.appendChild(el('div', 'grab'));
      sh.appendChild(el('h2', '', '백업 JSON — 전체 복사해서 메모장 등에 보관'));
      const ta = el('textarea');
      ta.value = json; ta.readOnly = true; ta.style.minHeight = '280px';
      sh.appendChild(ta);
      const act = el('div', 'actions');
      const copy = el('button', 'btn-primary', '전체 선택 + 복사');
      copy.onclick = () => {
        ta.focus(); ta.select(); ta.setSelectionRange(0, ta.value.length);
        let ok = false;
        try { ok = document.execCommand('copy'); } catch (e) {}
        toast(ok ? '복사 완료 — 메모장에 붙여넣어 보관하세요' : '길게 눌러 직접 복사하세요');
      };
      const close = el('button', 'btn-ghost', '닫기'); close.onclick = closeSheet;
      act.appendChild(close); act.appendChild(copy);
      sh.appendChild(act);
      scrim.appendChild(sh);
      $('overlay').appendChild(scrim);
    } },
    { icon: '📋', label: '클립보드에 바로 복사', fn: () => {
      const ok = () => toast('복사 완료');
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(json).then(ok).catch(() => copyFallback(json, ok));
      } else copyFallback(json, ok);
    } },
    { icon: '💾', label: '파일로 저장 (다운로드 폴더)', fn: () => {
      if (window.AndroidBridge && window.AndroidBridge.saveFile) {
        let ok = false;
        try { ok = window.AndroidBridge.saveFile(`quest-${todayStr()}.json`, json); } catch (e) {}
        toast(ok ? '📥 다운로드 폴더에 저장 완료 — PC로 옮기면 됩니다' : '저장 실패 — 텍스트 복사를 이용하세요');
        return;
      }
      const blob = new Blob([json], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `quest-${todayStr()}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    } },
  ]);
}
function copyFallback(text, ok) {
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.focus(); ta.select();
  try { document.execCommand('copy') ? ok() : toast('복사 실패 — 파일 저장을 이용하세요'); }
  catch (e) { toast('복사 실패 — 파일 저장을 이용하세요'); }
  ta.remove();
}

/* ---------- FAB (롱프레스로 위치 이동) ---------- */
function fab(fn) {
  const b = el('button', 'fab', '＋');
  try {
    const p = JSON.parse(localStorage.getItem('lifeos.fab'));
    if (p && p.r >= 0) { b.style.right = p.r + 'px'; b.style.bottom = p.b + 'px'; }
  } catch (e) {}
  let timer = null, dragging = false, moved = false, sx = 0, sy = 0, r0 = 0, b0 = 0;
  b.addEventListener('pointerdown', (e) => {
    sx = e.clientX; sy = e.clientY;
    r0 = parseFloat(b.style.right) || 20; b0 = parseFloat(b.style.bottom) || 86;
    timer = setTimeout(() => {
      timer = null; dragging = true; moved = false;
      b.classList.add('fabdrag');
      try { b.setPointerCapture(e.pointerId); } catch (x) {}
    }, 420);
  });
  b.addEventListener('pointermove', (e) => {
    if (dragging) {
      const r = Math.max(4, Math.min(window.innerWidth - 70, r0 - (e.clientX - sx)));
      const bo = Math.max(12, Math.min(window.innerHeight - 90, b0 - (e.clientY - sy)));
      b.style.right = r + 'px'; b.style.bottom = bo + 'px';
      moved = true;
    } else if (timer && Math.hypot(e.clientX - sx, e.clientY - sy) > 10) {
      clearTimeout(timer); timer = null;
    }
  });
  const end = () => {
    clearTimeout(timer); timer = null;
    if (dragging) {
      dragging = false;
      b.classList.remove('fabdrag');
      localStorage.setItem('lifeos.fab', JSON.stringify({ r: parseFloat(b.style.right) || 20, b: parseFloat(b.style.bottom) || 86 }));
    }
  };
  b.addEventListener('pointerup', end);
  b.addEventListener('pointercancel', end);
  b.onclick = () => { if (moved) { moved = false; return; } fn(); };
  document.body.appendChild(b);
}

/* 안드로이드 뒤로가기: 시트 → 페이지 → 섹션 → 홈탭 → 종료 확인 */
window.__back = function () {
  const ov = $('overlay');
  if (ov && ov.children.length) { closeSheet(); return; }
  if (UI.nodeStack && UI.nodeStack.length) { UI.nodeStack.pop(); render(); return; }
  if (UI.open) { UI.open = null; UI.search = ''; render(); return; }
  if (UI.tab !== 'today') { UI.tab = 'today'; render(); return; }
  exitConfirm();
};
function exitConfirm() {
  const scrim = el('div', 'scrim center');
  scrim.onclick = (e) => { if (e.target === scrim) scrim.remove(); };
  const pop = el('div', 'confirmpop');
  pop.appendChild(el('div', 'cicon', '☖'));
  pop.appendChild(el('h2', '', '앱을 종료할까요?'));
  pop.appendChild(el('p', '', '변경 사항은 자동으로 저장되어 있습니다.'));
  const act = el('div', 'cact');
  const stay = el('button', 'btn-ghost', '취소');
  stay.onclick = () => scrim.remove();
  const quit = el('button', 'btn-quit', '종료');
  quit.onclick = () => {
    if (window.AndroidBridge && window.AndroidBridge.exitApp) { try { window.AndroidBridge.exitApp(); } catch (e) {} }
    else scrim.remove();
  };
  act.appendChild(stay); act.appendChild(quit);
  pop.appendChild(act);
  scrim.appendChild(pop);
  $('overlay').appendChild(scrim);
}

applyFont();
render();
if (!S.sections.length && !S.today.length) loadEmbedded(false);
if (syncCfg()) syncNow(false);
