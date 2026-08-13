/* ============================================================
   코넬 학습지 빌더 — 앱 로직 (vanilla JS)
   ============================================================ */
(function () {
  'use strict';

  const STORE_KEY = 'cornell-worksheet-v1';
  const PAGE_H = 1123;        // A4 @96dpi
  const CONTENT_H = 1017;     // 대략적 인쇄 가능 높이 (1/3 ≈ 339, 1/2 ≈ 508)
  const DEFAULTS = {
    problem: { h: 340, ratio: 0.5, solBg: 'lines', probBg: 'blank' },
    concept: { h: 250, exBg: 'lines', tint: false },
    mock:    { h: 510, ratio: 0.45, solBg: 'lines', probBg: 'blank' },
  };

  /* ---------- 상태 ---------- */
  let state = load();
  let seeded = false;
  if (!state) {
    state = { meta: { title: '', tinted: false, showHead: true }, blocks: [], seeded: true };
    seeded = true;
  }
  let seq = state.blocks.reduce((m, b) => Math.max(m, b.id), 0) + 1;

  /* ---------- 유틸 ---------- */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  function el(tag, props = {}, kids = []) {
    const e = document.createElement(tag);
    for (const k in props) {
      if (k === 'class') e.className = props[k];
      else if (k === 'html') e.innerHTML = props[k];
      else if (k === 'text') e.textContent = props[k];
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), props[k]);
      else if (k === 'data') for (const d in props[k]) e.dataset[d] = props[k][d];
      else if (props[k] != null) e.setAttribute(k, props[k]);
    }
    (Array.isArray(kids) ? kids : [kids]).forEach(c => {
      if (c == null) return;
      e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return e;
  }
  function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {} }
  function load() { try { return JSON.parse(localStorage.getItem(STORE_KEY)); } catch (e) { return null; } }

  /* SVG 아이콘 */
  const I = {
    gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
    up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 15l-6-6-6 6"/></svg>',
    down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M10 11v6M14 11v6"/></svg>',
    image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="1.6"/><path d="M21 15l-5-5L5 21"/></svg>',
    grip: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>',
    print: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>',
  };

  /* ============================================================
     블록 생성
     ============================================================ */
  function makeBlock(type) {
    const d = DEFAULTS[type];
    const base = { id: seq++, type, h: d.h };
    if (type === 'problem')
      return Object.assign(base, { ratio: d.ratio, solBg: d.solBg, probBg: d.probBg,
        title: '', probHtml: '', solHtml: '' });
    if (type === 'concept')
      return Object.assign(base, { exBg: d.exBg, tint: d.tint, title: '', exHtml: '' });
    if (type === 'mock')
      return Object.assign(base, { ratio: d.ratio, solBg: d.solBg, probBg: d.probBg, title: '', probHtml: '', solHtml: '' });
  }
  function addBlock(type) {
    syncFromDOM();
    state.blocks.push(makeBlock(type));
    save(); render();
  }

  /* ============================================================
     DOM → 모델 동기화 (입력 중 재렌더 방지)
     ============================================================ */
  function syncFromDOM() {
    $$('.block').forEach(node => {
      const id = +node.dataset.id;
      const b = state.blocks.find(x => x.id === id);
      if (!b) return;
      const prob = $('.field.f-prob', node);
      const sol  = $('.field.f-sol', node);
      const ex   = $('.field.f-ex', node);
      const titleI = $('.btitle-input', node);
      if (prob) b.probHtml = prob.innerHTML;
      if (sol)  b.solHtml = sol.innerHTML;
      if (ex)   b.exHtml = ex.innerHTML;
      if (titleI) b.title = titleI.value;
    });
  }

  /* ============================================================
     렌더
     ============================================================ */
  const stackEl = () => $('#stack');

  function render() {
    const stack = stackEl();
    stack.innerHTML = '';
    if (!state.blocks.length) {
      stack.appendChild(el('div', { class: 'empty' }, [
        el('div', { class: 'big', text: '학습지가 비어 있어요' }),
        el('p', { html: '왼쪽에서 블록을 골라 추가하세요.<br>문제풀이 · 개념설명 · 모의고사 블록을 자유롭게 조합할 수 있습니다.' }),
      ]));
    } else {
      let n = { problem: 0, concept: 0, mock: 0 };
      state.blocks.forEach((b, i) => {
        n[b.type]++;
        stack.appendChild(renderBlock(b, i, n[b.type]));
      });
    }
    requestAnimationFrame(updateGuides);
  }

  function bgClass(mode) {
    return mode === 'lines' ? 'bg-lines' : mode === 'grid' ? 'bg-grid' : '';
  }

  function field(cls, ph, html, extra) {
    const f = el('div', {
      class: 'field ' + cls + (extra ? ' ' + extra : ''),
      contenteditable: 'true', spellcheck: 'false', data: { ph },
    });
    f.innerHTML = html || '';
    f.addEventListener('input', () => { syncOne(f); scheduleSave(); });
    return f;
  }
  function syncOne(node) {
    const block = node.closest('.block'); if (!block) return;
    const b = state.blocks.find(x => x.id === +block.dataset.id); if (!b) return;
    if (node.classList.contains('f-prob')) b.probHtml = node.innerHTML;
    else if (node.classList.contains('f-sol')) b.solHtml = node.innerHTML;
    else if (node.classList.contains('f-ex')) b.exHtml = node.innerHTML;
  }
  let saveT;
  function scheduleSave() { clearTimeout(saveT); saveT = setTimeout(save, 400); }

  function renderBlock(b, idx, typeNum) {
    const node = el('div', { class: 'block' + (b.type === 'mock' ? ' half' : ''), data: { id: b.id } });
    node.style.height = b.h + 'px';

    /* 헤더 */
    const isMock = b.type === 'mock';
    const tagText = b.type === 'problem' ? '문제' : b.type === 'concept' ? '개념' : '모의고사';
    const tag = el('div', { class: 'btag' + (isMock ? ' alt' : '') }, [
      tagText, b.type === 'concept' ? null : el('span', { class: 'num', text: ' ' + typeNum }),
    ]);
    const titleInput = el('input', {
      class: 'btitle-input', value: b.title || '',
      placeholder: b.type === 'concept' ? '개념 이름을 입력하세요' : '제목(선택) 입력',
      oninput: e => { b.title = e.target.value; scheduleSave(); },
    });

    const ctrl = el('div', { class: 'bctrl' }, [
      makeOptions(b, node),
      iconBtn(I.up, '위로', () => move(b.id, -1), idx === 0),
      iconBtn(I.down, '아래로', () => move(b.id, +1), idx === state.blocks.length - 1),
      iconBtn(I.trash, '삭제', () => del(b.id), false, 'danger'),
    ]);

    const grip = el('span', { class: 'icbtn', title: '드래그하여 이동', html: I.grip, style: 'cursor:grab' });
    grip.setAttribute('draggable', 'true');
    attachDrag(grip, node, b);

    node.appendChild(el('div', { class: 'bhead' }, [grip, tag, titleInput, ctrl]));

    /* 본문 */
    if (b.type === 'problem' || b.type === 'mock') {
      const prob = field('f-prob ' + bgClass(b.probBg), '문제를 입력하거나 이미지를 넣으세요', b.probHtml);
      const sol  = field('f-sol ' + bgClass(b.solBg), '풀이 공간', b.solHtml);
      const probPanel = el('div', { class: 'panel', style: 'flex:1' }, [
        el('span', { class: 'panel-label', text: '문제' }), imgTools(prob), prob,
      ]);
      enableImageDrop(probPanel, prob);
      const solPanel = el('div', { class: 'panel', style: 'flex:1' }, [
        el('span', { class: 'panel-label', text: '풀이' }), sol,
      ]);

      if (b.type === 'problem') {
        // 가로 배열: 문제 | 풀이
        probPanel.style.flex = b.ratio;
        solPanel.style.flex = 1 - b.ratio;
        const vdiv = el('div', { class: 'vdiv', title: '드래그하여 비율 조절' });
        enableSplit(vdiv, node, b);
        node.appendChild(el('div', { class: 'bbody' }, [probPanel, vdiv, solPanel]));
      } else {
        // 세로 배열: 문제 / 풀이 (모의고사) — 가운데 바로 비율 조절
        if (b.ratio == null) b.ratio = DEFAULTS.mock.ratio;
        probPanel.style.flex = b.ratio;
        solPanel.style.flex = 1 - b.ratio;
        const hdiv = el('div', { class: 'hdiv adjustable', title: '드래그하여 문제·풀이 비율 조절' });
        enableVSplit(hdiv, node, b);
        node.appendChild(el('div', { class: 'bbody col' }, [probPanel, hdiv, solPanel]));
      }
    } else {
      // 개념: 이름(헤더) / 설명
      const ex = field('f-ex ' + bgClass(b.exBg), '개념 설명을 작성하세요', b.exHtml, b.tint ? 'tint' : '');
      const exPanel = el('div', { class: 'panel', style: 'flex:1' }, [ex]);
      node.appendChild(el('div', { class: 'bbody col' }, [exPanel]));
    }

    /* 크기 조절 핸들 */
    const badge = el('span', { class: 'size-badge', text: sizeLabel(b.h) });
    const rh = el('div', { class: 'resize-h', title: '드래그하여 높이 조절' });
    enableResize(rh, node, b, badge);
    node.appendChild(rh);
    node.appendChild(badge);
    return node;
  }

  function sizeLabel(h) {
    const frac = h / CONTENT_H;
    let f = '';
    if (Math.abs(frac - 1 / 3) < 0.04) f = ' · A4 ⅓';
    else if (Math.abs(frac - 1 / 2) < 0.04) f = ' · A4 ½';
    else if (Math.abs(frac - 2 / 3) < 0.04) f = ' · A4 ⅔';
    else if (Math.abs(frac - 1) < 0.05) f = ' · A4 1쪽';
    return Math.round(h) + 'px' + f;
  }

  function iconBtn(svg, title, fn, disabled, extra) {
    return el('button', {
      class: 'icbtn' + (extra ? ' ' + extra : ''), title, html: svg,
      disabled: disabled ? 'disabled' : null,
      onclick: fn,
    });
  }

  function imgTools(field) {
    const input = el('input', { type: 'file', accept: 'image/*', style: 'display:none',
      onchange: e => { const f = e.target.files[0]; if (f) insertImage(field, f); e.target.value = ''; } });
    const btn = el('button', { class: 'minibtn', html: I.image + '<span>이미지</span>',
      onclick: () => input.click() });
    return el('div', { class: 'field-tools' }, [btn, input]);
  }

  /* ============================================================
     옵션 팝오버 (블록별 배경/틴트)
     ============================================================ */
  function makeOptions(b, node) {
    const wrap = el('div', { class: 'opt-wrap' });
    const pop = el('div', { class: 'popover' });
    const btn = el('button', { class: 'icbtn', title: '옵션', html: I.gear,
      onclick: e => { e.stopPropagation(); closePops(pop); pop.classList.toggle('open'); } });

    function seg(opts, current, onPick) {
      const row = el('div', { class: 'seg' });
      opts.forEach(o => {
        const bn = el('button', { class: current === o.val ? 'on' : '',
          onclick: () => { onPick(o.val); } }, [
          el('span', { class: 'ico ' + (o.ico || '') }), o.label,
        ]);
        row.appendChild(bn);
      });
      return row;
    }

    if (b.type === 'concept') {
      pop.appendChild(el('div', { class: 'pop-h', text: '설명 배경' }));
      pop.appendChild(seg(
        [{ val: 'blank', label: '무지' }, { val: 'lines', label: '줄글', ico: 'lines' }, { val: 'grid', label: '격자', ico: 'grid' }],
        b.exBg, v => { b.exBg = v; applyBg(node, '.f-ex', v); refreshSeg(pop, 0, v); save(); },
      ));
      pop.appendChild(el('div', { class: 'pop-h', text: '연한 배경' }));
      const tintRow = el('div', { class: 'seg' }, [
        el('button', { class: !b.tint ? 'on' : '', onclick: () => setTint(false) }, [el('span', { class: 'ico' }), '무배경']),
        el('button', { class: b.tint ? 'on' : '', onclick: () => setTint(true) }, [el('span', { class: 'ico tint' }), '연한 배경']),
      ]);
      function setTint(v) {
        b.tint = v;
        const f = $('.f-ex', node);
        f.classList.toggle('tint', v);
        [...tintRow.children].forEach((c, i) => c.classList.toggle('on', (i === 1) === v));
        save();
      }
      pop.appendChild(tintRow);
    } else {
      pop.appendChild(el('div', { class: 'pop-h', text: '문제 배경' }));
      pop.appendChild(seg(
        [{ val: 'blank', label: '무지' }, { val: 'lines', label: '줄글', ico: 'lines' }, { val: 'grid', label: '격자', ico: 'grid' }],
        b.probBg, v => { b.probBg = v; applyBg(node, '.f-prob', v); refreshSeg(pop, 0, v); save(); },
      ));
      pop.appendChild(el('div', { class: 'pop-h', text: '풀이 배경' }));
      pop.appendChild(seg(
        [{ val: 'blank', label: '무지' }, { val: 'lines', label: '줄글', ico: 'lines' }, { val: 'grid', label: '격자', ico: 'grid' }],
        b.solBg, v => { b.solBg = v; applyBg(node, '.f-sol', v); refreshSeg(pop, 1, v); save(); },
      ));
    }
    wrap.append(btn, pop);
    return wrap;
  }
  function refreshSeg(pop, segIdx, val) {
    const segs = $$('.seg', pop);
    const labels = { blank: '무지', lines: '줄글', grid: '격자' };
    [...segs[segIdx].children].forEach(c => c.classList.toggle('on', c.textContent.trim().endsWith(labels[val])));
  }
  function applyBg(node, sel, val) {
    const f = $(sel, node);
    f.classList.remove('bg-lines', 'bg-grid');
    if (val === 'lines') f.classList.add('bg-lines');
    else if (val === 'grid') f.classList.add('bg-grid');
  }
  function closePops(except) { $$('.popover.open').forEach(p => { if (p !== except) p.classList.remove('open'); }); }
  document.addEventListener('click', () => closePops(null));

  /* ============================================================
     이미지 삽입 (버튼 / 드래그앤드롭)
     ============================================================ */
  function insertImage(field, file) {
    const reader = new FileReader();
    reader.onload = () => {
      const img = el('img', { src: reader.result });
      field.focus();
      const sel = window.getSelection();
      if (sel && sel.rangeCount && field.contains(sel.anchorNode)) {
        const r = sel.getRangeAt(0); r.collapse(false); r.insertNode(img);
        r.setStartAfter(img); r.collapse(true); sel.removeAllRanges(); sel.addRange(r);
      } else {
        field.appendChild(img);
      }
      syncOne(field); save();
    };
    reader.readAsDataURL(file);
  }
  function enableImageDrop(panel, field) {
    ['dragenter', 'dragover'].forEach(ev => panel.addEventListener(ev, e => {
      if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) {
        e.preventDefault(); panel.classList.add('drag-over');
      }
    }));
    ['dragleave', 'drop'].forEach(ev => panel.addEventListener(ev, e => {
      if (ev === 'drop') {
        const f = e.dataTransfer.files[0];
        if (f && f.type.startsWith('image/')) { e.preventDefault(); insertImage(field, f); }
      }
      panel.classList.remove('drag-over');
    }));
  }

  /* ============================================================
     이동 / 삭제
     ============================================================ */
  function move(id, dir) {
    syncFromDOM();
    const i = state.blocks.findIndex(b => b.id === id);
    const j = i + dir;
    if (j < 0 || j >= state.blocks.length) return;
    [state.blocks[i], state.blocks[j]] = [state.blocks[j], state.blocks[i]];
    save(); render();
  }
  function del(id) {
    syncFromDOM();
    state.blocks = state.blocks.filter(b => b.id !== id);
    save(); render();
  }

  /* 드래그 정렬 */
  let dragId = null;
  function attachDrag(handle, node, b) {
    handle.addEventListener('dragstart', e => {
      dragId = b.id; node.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(b.id));
      try { e.dataTransfer.setDragImage(node, 20, 20); } catch (_) {}
    });
    handle.addEventListener('dragend', () => {
      dragId = null; node.classList.remove('dragging');
      $$('.block').forEach(n => n.classList.remove('drop-before', 'drop-after'));
    });
    node.addEventListener('dragover', e => {
      if (dragId == null || dragId === b.id) return;
      e.preventDefault();
      const r = node.getBoundingClientRect();
      const after = (e.clientY - r.top) > r.height / 2;
      node.classList.toggle('drop-after', after);
      node.classList.toggle('drop-before', !after);
    });
    node.addEventListener('dragleave', () => node.classList.remove('drop-before', 'drop-after'));
    node.addEventListener('drop', e => {
      if (dragId == null || dragId === b.id) return;
      e.preventDefault();
      syncFromDOM();
      const from = state.blocks.findIndex(x => x.id === dragId);
      const moved = state.blocks.splice(from, 1)[0];
      let to = state.blocks.findIndex(x => x.id === b.id);
      const r = node.getBoundingClientRect();
      if ((e.clientY - r.top) > r.height / 2) to += 1;
      state.blocks.splice(to, 0, moved);
      save(); render();
    });
  }

  /* ============================================================
     크기 조절 (높이) & 분할 비율
     ============================================================ */
  function curZoom() { return state.zoom || 1; }
  function enableResize(handle, node, b, badge) {
    handle.addEventListener('pointerdown', e => {
      e.preventDefault();
      const z = curZoom();
      const startY = e.clientY, startH = b.h;
      handle.setPointerCapture(e.pointerId);
      const mv = ev => {
        const h = Math.max(120, Math.round(startH + (ev.clientY - startY) / z));
        b.h = h; node.style.height = h + 'px';
        badge.textContent = sizeLabel(h);
        updateGuides();
      };
      const up = () => {
        handle.removeEventListener('pointermove', mv);
        handle.removeEventListener('pointerup', up);
        save();
      };
      handle.addEventListener('pointermove', mv);
      handle.addEventListener('pointerup', up);
    });
  }
  function enableVSplit(div, node, b) {
    div.addEventListener('pointerdown', e => {
      e.preventDefault();
      const body = div.parentElement;
      const rect = body.getBoundingClientRect();
      div.setPointerCapture(e.pointerId);
      const mv = ev => {
        let ratio = (ev.clientY - rect.top) / rect.height;
        ratio = Math.min(0.8, Math.max(0.2, ratio));
        b.ratio = ratio;
        const panels = $$('.panel', body);
        panels[0].style.flex = ratio;
        panels[1].style.flex = 1 - ratio;
      };
      const up = () => {
        div.removeEventListener('pointermove', mv);
        div.removeEventListener('pointerup', up);
        save();
      };
      div.addEventListener('pointermove', mv);
      div.addEventListener('pointerup', up);
    });
  }
  function enableSplit(div, node, b) {
    div.addEventListener('pointerdown', e => {
      e.preventDefault();
      const body = div.parentElement;
      const rect = body.getBoundingClientRect();
      const z = curZoom();
      div.setPointerCapture(e.pointerId);
      const mv = ev => {
        let ratio = (ev.clientX - rect.left) / (rect.width);
        ratio = Math.min(0.8, Math.max(0.2, ratio));
        b.ratio = ratio;
        const panels = $$('.panel', body);
        panels[0].style.flex = ratio;
        panels[1].style.flex = 1 - ratio;
      };
      const up = () => {
        div.removeEventListener('pointermove', mv);
        div.removeEventListener('pointerup', up);
        save();
      };
      div.addEventListener('pointermove', mv);
      div.addEventListener('pointerup', up);
    });
  }

  /* ============================================================
     페이지 경계 가이드
     ============================================================ */
  function updateGuides() {
    const sheet = $('#sheet');
    let g = $('#pageGuides');
    if (!g) { g = el('div', { class: 'page-guides', id: 'pageGuides' }); sheet.appendChild(g); }
    g.innerHTML = '';
    const total = sheet.scrollHeight;
    for (let y = PAGE_H, p = 2; y < total; y += PAGE_H, p++) {
      g.appendChild(el('div', { class: 'pbreak', style: 'top:' + y + 'px' },
        el('span', { text: p + '쪽' })));
    }
  }

  /* ============================================================
     줌
     ============================================================ */
  function applyZoom() {
    const sheet = $('#sheet');
    const z = curZoom();
    sheet.style.transform = 'scale(' + z + ')';
    const wrap = $('#sheetWrap');
    wrap.style.height = (sheet.offsetHeight * z) + 'px';
    $('#zlabel').textContent = Math.round(z * 100) + '%';
  }
  function setZoom(z) { state.zoom = Math.min(1.5, Math.max(0.4, z)); save(); applyZoom(); }

  /* ============================================================
     초기 구성 (셸)
     ============================================================ */
  function buildShell() {
    const app = $('#app');

    // 브랜드
    app.appendChild(el('div', { class: 'brand' }, [
      el('div', { class: 'mark' }),
      el('h1', { html: '코넬 학습지 <span>빌더</span>' }),
    ]));

    // 툴바
    const zoomGroup = el('div', { class: 'toolgroup' }, [
      el('button', { class: 'zbtn', text: '−', onclick: () => setZoom(curZoom() - 0.1) }),
      el('span', { class: 'zlabel', id: 'zlabel', text: '100%' }),
      el('button', { class: 'zbtn', text: '+', onclick: () => setZoom(curZoom() + 0.1) }),
    ]);
    app.appendChild(el('div', { class: 'topbar' }, [
      zoomGroup,
      el('div', { class: 'spacer' }),
      el('button', { class: 'tbtn ghost', text: '전체 비우기', onclick: resetAll }),
      el('button', { class: 'tbtn primary', html: I.print + '<span>인쇄 / PDF</span>', onclick: () => window.print() }),
    ]));

    // 사이드바
    const sidebar = el('aside', { class: 'sidebar' });
    sidebar.appendChild(el('div', { class: 'side-section' }, [
      el('div', { class: 'side-h', text: '블록 추가' }),
      el('div', { class: 'palette' }, [
        paletteCard('problem', '문제풀이', '문제 · 풀이 가로 배열. 문제칸에 이미지 삽입. 기본 A4 ⅓.', thumbProblem()),
        paletteCard('concept', '개념설명', '개념 이름 · 설명 세로 배열. 줄글/격자, 연한 배경 선택.', thumbConcept()),
        paletteCard('mock', '모의고사', '가로 A4 ½ 폭 · 세로 2단. 문제 위, 긴 풀이 아래. 두 개가 나란히 배치돼요.', thumbMock()),
      ]),
    ]));
    sidebar.appendChild(el('div', { class: 'side-section' }, [
      el('div', { class: 'side-h', text: '학습지 옵션' }),
      el('div', {}, [
        optRow('헤더(제목·이름칸) 표시', state.meta.showHead, v => { state.meta.showHead = v; save(); renderHead(); }),
      ]),
    ]));
    sidebar.appendChild(el('div', { class: 'side-section' }, [
      el('div', { class: 'side-note', html: '<b>팁</b> · 블록 우측 톱니에서 줄글/격자·배경을 바꿀 수 있어요. 아래 손잡이를 끌어 높이를, 가운데 선을 끌어 문제·풀이 비율을 조절하세요. 좌측 점 6개를 끌면 순서가 바뀝니다.' }),
    ]));
    app.appendChild(sidebar);

    // 캔버스
    const sheet = el('div', { class: 'sheet', id: 'sheet', data: { screenLabel: 'A4 학습지' } });
    sheet.appendChild(el('div', { class: 'sheet-head', id: 'sheetHead' }));
    sheet.appendChild(el('div', { class: 'stack', id: 'stack' }));
    const wrap = el('div', { class: 'sheet-wrap', id: 'sheetWrap' }, sheet);
    app.appendChild(el('main', { class: 'canvas', id: 'canvas' }, wrap));
  }

  function paletteCard(type, title, desc, thumb) {
    return el('button', { class: 'pcard', onclick: () => addBlock(type) }, [
      el('div', { class: 'pthumb' }, thumb),
      el('div', {}, [el('p', { class: 'ptitle', text: title }), el('p', { class: 'pdesc', text: desc })]),
    ]);
  }
  function thumbProblem() {
    return el('div', { class: 'th-row' }, [
      el('div', { class: 'th-box', style: 'flex:1' }),
      el('div', { class: 'th-box th-lines', style: 'flex:1' }),
    ]);
  }
  function thumbConcept() {
    return el('div', { class: 'th-col' }, [
      el('div', { class: 'th-box fill th-bar' }),
      el('div', { class: 'th-box th-lines', style: 'flex:1' }),
    ]);
  }
  function thumbMock() {
    return el('div', { class: 'th-row' }, [
      el('div', { class: 'th-col', style: 'position:relative;inset:auto;flex:1' }, [
        el('div', { class: 'th-box', style: 'flex:.4' }),
        el('div', { class: 'th-box th-lines', style: 'flex:1' }),
      ]),
      el('div', { style: 'flex:1' }),
    ]);
  }
  function optRow(label, val, fn) {
    const input = el('input', { type: 'checkbox', onchange: e => fn(e.target.checked) });
    if (val) input.checked = true;
    return el('div', { class: 'opt-row' }, [
      el('label', { text: label }),
      el('label', { class: 'switch' }, [input, el('span', { class: 'track' })]),
    ]);
  }

  function renderHead() {
    const head = $('#sheetHead');
    head.innerHTML = '';
    head.style.display = state.meta.showHead ? '' : 'none';
    if (!state.meta.showHead) return;
    head.appendChild(el('div', { class: 'sheet-eyebrow', text: 'CORNELL STUDY SHEET · 학습지' }));
    const title = el('div', {
      class: 'sheet-title', contenteditable: 'true', spellcheck: 'false',
      data: { ph: '학습지 제목을 입력하세요' },
    });
    title.textContent = state.meta.title || '';
    if (!state.meta.title) title.dataset.empty = '1';
    title.addEventListener('input', () => { state.meta.title = title.textContent; scheduleSave(); });
    head.appendChild(title);
    head.appendChild(el('div', { class: 'sheet-meta' }, [
      metaField('이름'), metaField('학년 · 반'), metaField('날짜'),
    ]));
  }
  function metaField(label) {
    return el('div', { class: 'meta-field' }, [
      el('span', { text: label }), el('span', { class: 'meta-line' }),
    ]);
  }

  function resetAll() {
    if (!confirm('모든 블록과 내용을 지울까요?')) return;
    state = { meta: { title: '', tinted: false, showHead: true }, blocks: [], zoom: state.zoom };
    seq = 1; save(); renderHead(); render(); applyZoom();
  }

  // contenteditable 제목 placeholder
  const styleFix = document.createElement('style');
  styleFix.textContent = '.sheet-title:empty::before{content:attr(data-ph);color:var(--ink-faint);font-weight:400;}';
  document.head.appendChild(styleFix);

  /* ---------- 부팅 ---------- */
  if (seeded) {
    state.blocks = [makeBlock('problem'), makeBlock('concept'), makeBlock('mock'), makeBlock('mock')];
    save();
  }
  buildShell();
  renderHead();
  render();
  applyZoom();
  window.addEventListener('beforeprint', () => { $('#sheet').style.transform = 'none'; });
  window.addEventListener('afterprint', applyZoom);
  // 시트 높이 변동 시 줌 래퍼 갱신
  new ResizeObserver(() => applyZoom()).observe($('#sheet'));
})();
