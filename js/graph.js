/*
 * BREATHE NodeSim - node graph renderer (SVG)
 * Draws the physiology nodes and their causal links, animates the links whose
 * source is changing, highlights the neighbourhood of the selected node.
 */
(function (global) {
	'use strict';

	const SVGNS = 'http://www.w3.org/2000/svg';
	const NODE_W = 184, NODE_H = 62, COL_W = 240, ROW_H = 76, TOP = 46, LEFT = 16, PAD = 10;
	const LAYOUT_KEY = 'breathe-nodesim-layout-v2';

	function el(name, attrs, parent) {
		const e = document.createElementNS(SVGNS, name);
		for (const k in attrs) e.setAttribute(k, attrs[k]);
		if (parent) parent.appendChild(e);
		return e;
	}

	//Set the text of an SVG text element, truncating it with an ellipsis if wider than maxWidth
	function fitText(textEl, text, maxWidth) {
		if (textEl.__full === text && textEl.__max === maxWidth) return;
		textEl.__full = text; textEl.__max = maxWidth;
		textEl.textContent = text;
		if (!text || maxWidth <= 0) { if (maxWidth <= 0) textEl.textContent = ''; return; }
		let w;
		try { w = textEl.getComputedTextLength(); } catch (e) { return; }
		if (!w || w <= maxWidth) return;
		let lo = 0, hi = text.length;
		while (lo < hi) {
			const mid = Math.ceil((lo + hi) / 2);
			textEl.textContent = text.slice(0, mid).trimEnd() + '…';
			if (textEl.getComputedTextLength() <= maxWidth) lo = mid; else hi = mid - 1;
		}
		textEl.textContent = lo > 0 ? text.slice(0, lo).trimEnd() + '…' : '';
	}

	function textWidth(textEl) {
		try { return textEl.getComputedTextLength(); } catch (e) { return 0; }
	}

	function fmt(v, dec) {
		if (!isFinite(v)) return '–';
		return v.toFixed(dec).replace('-', '−');
	}

	class NodeGraph {

		constructor(svg, catalog, onSelect) {
			this.svg = svg;
			this.C = catalog;
			this.onSelect = onSelect;
			this.selected = null;
			this.activity = {};
			this.lastValues = {};
			this.pos = {};
			this.loadLayout();
			this.build();
			this.fit();
			this.bindViewport();
			if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => this.refitLabels());
		}

		//Text widths change once the web fonts are loaded: measure again
		refitLabels() {
			this.C.NODES.forEach(n => {
				const els = this.nodeEls[n.id];
				els.label.__full = null; els.sub.__full = null;
				fitText(els.label, n.label, NODE_W - 24 - PAD);
			});
		}

		defaultPos(n) { return { x: LEFT + n.col * COL_W, y: TOP + n.row * ROW_H }; }

		loadLayout() {
			let saved = {};
			try { saved = JSON.parse(localStorage.getItem(LAYOUT_KEY) || '{}'); } catch (e) { saved = {}; }
			this.C.NODES.forEach(n => { this.pos[n.id] = saved[n.id] || this.defaultPos(n); });
		}

		saveLayout() {
			try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(this.pos)); } catch (e) { /* storage unavailable */ }
		}

		resetLayout() {
			this.C.NODES.forEach(n => { this.pos[n.id] = this.defaultPos(n); this.placeNode(n.id); });
			try { localStorage.removeItem(LAYOUT_KEY); } catch (e) { /* storage unavailable */ }
			this.redrawEdges();
			this.fit();
		}

		build() {
			const svg = this.svg;
			svg.innerHTML = '';
			const defs = el('defs', {}, svg);
			['pos', 'neg', 'amb'].forEach(k => {
				const mk = el('marker', { id: 'arrow-' + k, viewBox: '0 0 10 10', refX: '9', refY: '5', markerWidth: '7', markerHeight: '7', orient: 'auto-start-reverse' }, defs);
				el('path', { d: 'M0,1 L9,5 L0,9 z', class: 'arrowhead ' + k }, mk);
			});
			this.root = el('g', { class: 'viewport' }, svg);
			this.headers = el('g', { class: 'col-headers' }, this.root);
			this.edgeLayer = el('g', { class: 'edges' }, this.root);
			this.nodeLayer = el('g', { class: 'nodes' }, this.root);

			const colTitles = ['Ventilatore e paziente', 'Meccanica', 'Polmone e scambi', 'Ritorno venoso e cuore dx', 'Cuore e circolo sistemico', 'Trasporto di O₂'];
			colTitles.forEach((t, i) => {
				const tx = el('text', { x: LEFT + i * COL_W + 2, y: 22, class: 'col-title' }, this.headers);
				fitText(tx, t.toUpperCase(), COL_W - 20);
			});

			this.edges = [];
			this.C.NODES.forEach(n => n.in.forEach(([src, sign]) => {
				const k = sign === '+' ? 'pos' : sign === '-' ? 'neg' : 'amb';
				const g = el('g', { class: 'edge ' + k }, this.edgeLayer);
				const path = el('path', { class: 'edge-line', 'marker-end': 'url(#arrow-' + k + ')' }, g);
				const badge = el('g', { class: 'edge-sign' }, g);
				el('circle', { r: '7' }, badge);
				const t = el('text', { 'text-anchor': 'middle', dy: '3.5' }, badge);
				t.textContent = sign === '-' ? '−' : sign;
				this.edges.push({ src, dst: n.id, sign, g, path, badge });
			}));

			this.nodeEls = {};
			this.C.NODES.forEach(n => {
				const g = el('g', { class: 'node', tabindex: '0', role: 'button', 'data-id': n.id }, this.nodeLayer);
				const cat = this.C.CATEGORIES[n.cat];
				el('rect', { class: 'node-box', width: NODE_W, height: NODE_H, rx: '7' }, g);
				el('rect', { class: 'node-cat', x: '10', y: '10', width: '8', height: '8', rx: '2', style: 'fill:' + cat.color }, g);
				//line 1: label; line 2: value + unit; line 3: subtitle (left) and change since reference (right)
				const label = el('text', { class: 'node-label', x: '24', y: '18' }, g);
				const value = el('text', { class: 'node-value', x: PAD, y: '39' }, g);
				const vNum = el('tspan', {}, value);
				const vUnit = el('tspan', { class: 'node-unit', dx: '4' }, value);
				const sub = el('text', { class: 'node-sub', x: PAD, y: '55' }, g);
				const delta = el('text', { class: 'node-delta', x: NODE_W - PAD, y: '55', 'text-anchor': 'end' }, g);
				const title = el('title', {}, g);
				title.textContent = n.label + ' – ' + cat.label;
				this.nodeEls[n.id] = { g, label, value, vNum, vUnit, delta, sub };
				fitText(label, n.label, NODE_W - 24 - PAD);
				this.placeNode(n.id);
				this.bindNode(g, n);
			});
			this.redrawEdges();
		}

		placeNode(id) {
			const p = this.pos[id];
			this.nodeEls[id].g.setAttribute('transform', 'translate(' + p.x + ',' + p.y + ')');
		}

		edgeGeometry(a, b) {
			const ax = a.x, ay = a.y + NODE_H / 2, bx = b.x, by = b.y + NODE_H / 2;
			let x1, x2, c1, c2;
			if (Math.abs(ax - bx) < NODE_W * 0.6) {
				//same column: loop on the right side
				x1 = ax + NODE_W; x2 = bx + NODE_W;
				const bulge = 34 + Math.min(60, Math.abs(ay - by) * 0.15);
				c1 = x1 + bulge; c2 = x2 + bulge;
			} else if (bx > ax) {
				x1 = ax + NODE_W; x2 = bx;
				const dx = Math.max(40, (x2 - x1) * 0.45);
				c1 = x1 + dx; c2 = x2 - dx;
			} else {
				x1 = ax; x2 = bx + NODE_W;
				const dx = Math.max(40, (x1 - x2) * 0.45);
				c1 = x1 - dx; c2 = x2 + dx;
			}
			const d = 'M' + x1 + ',' + ay + ' C' + c1 + ',' + ay + ' ' + c2 + ',' + by + ' ' + x2 + ',' + by;
			//cubic bezier midpoint
			const mx = 0.125 * x1 + 0.375 * c1 + 0.375 * c2 + 0.125 * x2;
			const my = 0.5 * ay + 0.5 * by;
			return { d, mx, my };
		}

		redrawEdges(onlyId) {
			this.edges.forEach(e => {
				if (onlyId && e.src !== onlyId && e.dst !== onlyId) return;
				const geo = this.edgeGeometry(this.pos[e.src], this.pos[e.dst]);
				e.path.setAttribute('d', geo.d);
				e.badge.setAttribute('transform', 'translate(' + geo.mx + ',' + geo.my + ')');
			});
		}

		bindNode(g, n) {
			let drag = null;
			g.addEventListener('pointerdown', ev => {
				ev.stopPropagation();
				const pt = this.toGraph(ev);
				drag = { dx: pt.x - this.pos[n.id].x, dy: pt.y - this.pos[n.id].y, moved: false, sx: ev.clientX, sy: ev.clientY };
				g.setPointerCapture(ev.pointerId);
			});
			g.addEventListener('pointermove', ev => {
				if (!drag) return;
				if (!drag.moved && Math.hypot(ev.clientX - drag.sx, ev.clientY - drag.sy) < 4) return;
				drag.moved = true;
				const pt = this.toGraph(ev);
				this.pos[n.id] = { x: Math.round(pt.x - drag.dx), y: Math.round(pt.y - drag.dy) };
				this.placeNode(n.id);
				this.redrawEdges(n.id);
			});
			g.addEventListener('pointerup', () => {
				if (drag && drag.moved) this.saveLayout();
				else this.select(this.selected === n.id ? null : n.id);
				drag = null;
			});
			g.addEventListener('keydown', ev => {
				if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); this.select(n.id); }
			});
		}

		select(id) {
			this.selected = id;
			const near = new Set();
			if (id) {
				near.add(id);
				this.C.byId[id].in.forEach(([s]) => near.add(s));
				this.C.byId[id].out.forEach(([d]) => near.add(d));
			}
			this.svg.classList.toggle('has-selection', !!id);
			for (const k in this.nodeEls) {
				const g = this.nodeEls[k].g;
				g.classList.toggle('selected', k === id);
				g.classList.toggle('near', near.has(k) && k !== id);
			}
			this.edges.forEach(e => {
				e.g.classList.toggle('upstream', e.dst === id);
				e.g.classList.toggle('downstream', e.src === id);
			});
			if (this.onSelect) this.onSelect(id);
		}

		/*
		 * Update values. ref = reference snapshot for the delta chips, dtSim = simulated seconds since last call
		 */
		update(o, ref, dtSim) {
			const C = this.C;
			C.NODES.forEach(n => {
				const v = C.nodeValue(n, o);
				const els = this.nodeEls[n.id];
				els.vNum.textContent = fmt(v, n.dec);
				const unit = n.unitFn ? n.unitFn(o) : n.unit;
				if (els.vUnit.textContent !== unit) els.vUnit.textContent = unit;
				if (n.labelFn) fitText(els.label, n.labelFn(o), NODE_W - 24 - PAD);
				const status = C.nodeStatus(n, o);
				els.g.classList.toggle('warn', status === 'warn');
				els.g.classList.toggle('crit', status === 'crit');

				let deltaText = '', deltaClass = 'node-delta';
				if (ref) {
					const r = C.nodeValue(n, ref);
					const d = v - r;
					const sig = Math.abs(d) >= Math.max(Math.pow(10, -n.dec) * 0.5, Math.abs(r) * 0.01);
					if (sig) {
						deltaText = (d > 0 ? '▲ ' : '▼ ') + fmt(Math.abs(d), n.dec);
						deltaClass += d > 0 ? ' up' : ' down';
					}
				}
				els.delta.textContent = deltaText;
				els.delta.setAttribute('class', deltaClass);
				const deltaW = deltaText ? textWidth(els.delta) + 8 : 0;
				fitText(els.sub, n.subFn ? n.subFn(o) : '', NODE_W - 2 * PAD - deltaW);

				//activity: relative rate of change (per simulated second), smoothed
				const last = this.lastValues[n.id];
				let rate = 0;
				if (last !== undefined && dtSim > 0) rate = Math.abs(v - last) / (Math.abs(v) + Math.abs(last) + 1e-3) * 2 / dtSim;
				this.activity[n.id] = 0.6 * (this.activity[n.id] || 0) + 0.4 * rate;
				this.lastValues[n.id] = v;
			});
			this.edges.forEach(e => {
				const a = this.activity[e.src] || 0;
				e.g.classList.toggle('active', a > 0.0015);
				e.g.classList.toggle('fast', a > 0.01);
			});
		}

		/* ------------------------------------------------------ viewport */

		bindViewport() {
			const svg = this.svg;
			let pan = null;
			svg.addEventListener('pointerdown', ev => {
				pan = { x: ev.clientX, y: ev.clientY, vb: this.vb.slice(), moved: false };
				svg.setPointerCapture(ev.pointerId);
			});
			svg.addEventListener('pointermove', ev => {
				if (!pan) return;
				const k = this.vb[2] / svg.clientWidth;
				const dx = (ev.clientX - pan.x) * k, dy = (ev.clientY - pan.y) * k;
				if (Math.abs(dx) + Math.abs(dy) > 2) pan.moved = true;
				this.setViewBox([pan.vb[0] - dx, pan.vb[1] - dy, pan.vb[2], pan.vb[3]]);
			});
			svg.addEventListener('pointerup', () => {
				if (pan && !pan.moved && this.selected) this.select(null);
				pan = null;
			});
			svg.addEventListener('wheel', ev => {
				ev.preventDefault();
				const pt = this.toGraph(ev);
				this.zoom(ev.deltaY > 0 ? 1.12 : 1 / 1.12, pt);
			}, { passive: false });
			window.addEventListener('resize', () => this.fit());
		}

		bounds() {
			let x0 = Infinity, y0 = 0, x1 = -Infinity, y1 = -Infinity;
			for (const k in this.pos) {
				const p = this.pos[k];
				x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x + NODE_W + 50); y1 = Math.max(y1, p.y + NODE_H);
			}
			return { x: x0 - 10, y: y0, w: x1 - x0 + 20, h: y1 - y0 + 16 };
		}

		fit() {
			const b = this.bounds();
			const cw = this.svg.clientWidth || 800, ch = this.svg.clientHeight || 500;
			const scale = Math.max(b.w / cw, b.h / ch);
			const w = cw * scale, h = ch * scale;
			this.setViewBox([b.x - (w - b.w) / 2, b.y - (h - b.h) / 2, w, h]);
		}

		zoom(f, center) {
			const vb = this.vb;
			const c = center || { x: vb[0] + vb[2] / 2, y: vb[1] + vb[3] / 2 };
			const w = Math.min(4000, Math.max(250, vb[2] * f)), k = w / vb[2];
			this.setViewBox([c.x - (c.x - vb[0]) * k, c.y - (c.y - vb[1]) * k, w, vb[3] * k]);
		}

		setViewBox(vb) {
			this.vb = vb;
			this.svg.setAttribute('viewBox', vb.map(v => v.toFixed(1)).join(' '));
		}

		toGraph(ev) {
			const r = this.svg.getBoundingClientRect();
			const k = this.vb[2] / r.width;
			return { x: this.vb[0] + (ev.clientX - r.left) * k, y: this.vb[1] + (ev.clientY - r.top) * k };
		}
	}

	global.NodeGraph = NodeGraph;
})(window);
