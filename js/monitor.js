/*
 * BREATHE NodeSim - bedside monitor (sweeping waveforms) and trend charts
 */
(function (global) {
	'use strict';

	function setupCanvas(canvas) {
		const dpr = window.devicePixelRatio || 1;
		const w = canvas.clientWidth, h = canvas.clientHeight;
		if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
			canvas.width = Math.round(w * dpr);
			canvas.height = Math.round(h * dpr);
		}
		const ctx = canvas.getContext('2d');
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		return { ctx, w, h };
	}

	function cssVar(name) {
		return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
	}

	/*
	 * Waveforms sweep in wall-clock time (so they look natural at any simulation speed)
	 * while their shape comes from the current model output.
	 */
	class Monitor {

		constructor(canvas) {
			this.canvas = canvas;
			this.window = 8; // seconds on screen
			this.traces = [
				{ key: 'paw', label: 'Paw', unit: 'cmH₂O', color: '#f4c542', min: -5, max: 45, buf: [] },
				{ key: 'flow', label: 'Flusso', unit: 'L/min', color: '#5cc8f0', min: -80, max: 80, buf: [] },
				{ key: 'abp', label: 'ABP', unit: 'mmHg', color: '#ff5d62', min: 20, max: 160, buf: [] }
			];
			this.cursor = 0;
			this.lastT = null;
			this.beatPhase = 0;
			this.breathPhase = 0;
		}

		sampleBreath(wave, phaseSec) {
			const t = wave.t, n = t.length;
			const x = phaseSec % wave.ttot;
			let i = Math.min(n - 2, Math.floor(x / wave.ttot * (n - 1)));
			if (i < 0) i = 0;
			const f = (x - t[i]) / ((t[i + 1] - t[i]) || 1);
			return { paw: wave.paw[i] + (wave.paw[i + 1] - wave.paw[i]) * f, flow: wave.flow[i] + (wave.flow[i + 1] - wave.flow[i]) * f };
		}

		abpShape(ph) {
			//systolic upstroke, decay with dicrotic notch
			if (ph < 0.12) return Math.sin(ph / 0.12 * Math.PI / 2);
			if (ph < 0.35) return 1 - 0.55 * (ph - 0.12) / 0.23;
			if (ph < 0.40) return 0.45 + 0.08 * Math.sin((ph - 0.35) / 0.05 * Math.PI);
			return 0.45 * Math.exp(-(ph - 0.40) * 2.2) * (1 - (ph - 0.4) * 0.2);
		}

		push(o, nowMs) {
			if (this.lastT === null) { this.lastT = nowMs; return; }
			const dt = Math.min(0.1, (nowMs - this.lastT) / 1000);
			this.lastT = nowMs;
			const wave = o.wave;
			this.breathPhase = (this.breathPhase + dt) % wave.ttot;
			this.beatPhase = (this.beatPhase + dt * o.hr / 60) % 1;
			const b = this.sampleBreath(wave, this.breathPhase);
			//respiratory modulation of pulse pressure (reverse pulsus paradoxus during positive pressure breaths)
			const resp = o.rr > 0 ? Math.sin(2 * Math.PI * (this.breathPhase / wave.ttot) - 0.6) : 0;
			const pp = (o.sbp - o.dbp) * (1 + resp * o.ppv / 200);
			const abp = o.dbp + pp * this.abpShape(this.beatPhase) + resp * o.ppv * 0.05;
			const vals = { paw: b.paw, flow: b.flow, abp };
			this.cursor = (this.cursor + dt / this.window) % 1;
			const keepAfter = nowMs - this.window * 1000 * 0.97;
			this.traces.forEach(tr => {
				tr.buf.push({ x: this.cursor, v: vals[tr.key], tw: nowMs });
				while (tr.buf.length && tr.buf[0].tw < keepAfter) tr.buf.shift();
			});
			this.lastValues = vals;
		}

		draw(o) {
			const { ctx, w, h } = setupCanvas(this.canvas);
			ctx.fillStyle = '#05080a';
			ctx.fillRect(0, 0, w, h);
			const bandH = h / this.traces.length;
			//autoscale pressure traces to current settings
			this.traces[0].max = Math.max(30, Math.ceil((o.ppeak + 5) / 10) * 10);
			const fmax = Math.max(40, Math.ceil(Math.max(...o.wave.flow.map(Math.abs)) / 20) * 20 + 10);
			this.traces[1].min = -fmax; this.traces[1].max = fmax;
			this.traces[2].max = Math.max(140, Math.ceil((o.sbp + 15) / 20) * 20);
			this.traces[2].min = Math.max(0, Math.floor((o.dbp - 25) / 20) * 20);

			ctx.font = '600 11px "IBM Plex Sans Condensed", "Arial Narrow", sans-serif';
			this.traces.forEach((tr, i) => {
				const y0 = i * bandH;
				const ymap = v => y0 + 6 + (1 - (v - tr.min) / (tr.max - tr.min)) * (bandH - 12);
				ctx.strokeStyle = 'rgba(255,255,255,0.07)';
				ctx.lineWidth = 1;
				ctx.beginPath();
				const zero = tr.min < 0 ? 0 : tr.min;
				ctx.moveTo(0, ymap(zero)); ctx.lineTo(w, ymap(zero));
				ctx.stroke();
				ctx.fillStyle = tr.color;
				ctx.fillText(tr.label, 8, y0 + 15);
				ctx.fillStyle = 'rgba(255,255,255,0.45)';
				ctx.fillText(tr.max + ' ' + tr.unit, 8, y0 + 28);
				//trace (the buffer holds just under one sweep, leaving a gap ahead of the cursor)
				ctx.strokeStyle = tr.color;
				ctx.lineWidth = 1.6;
				ctx.beginPath();
				let prevX = null;
				tr.buf.forEach(p => {
					const x = p.x * w;
					const y = ymap(Math.max(tr.min, Math.min(tr.max, p.v)));
					if (prevX === null || x < prevX) ctx.moveTo(x, y); else ctx.lineTo(x, y);
					prevX = x;
				});
				ctx.stroke();
			});
		}
	}

	/*
	 * Trend small multiples with event markers
	 */
	class Trends {

		constructor(container, series) {
			this.container = container;
			this.series = series;
			this.data = [];
			this.events = [];
			this.span = 15 * 60;
			container.innerHTML = '';
			this.cells = series.map(s => {
				const cell = document.createElement('div');
				cell.className = 'trend';
				cell.innerHTML = '<div class="trend-head"><span class="trend-label"></span><span class="trend-value"></span></div><canvas></canvas>';
				cell.querySelector('.trend-label').textContent = s.label;
				container.appendChild(cell);
				return { cell, canvas: cell.querySelector('canvas'), value: cell.querySelector('.trend-value') };
			});
		}

		record(o) {
			const row = { t: o.t };
			this.series.forEach(s => s.keys.forEach(k => { row[k] = o[k]; }));
			this.data.push(row);
			if (this.data.length > 4000) this.data.shift();
		}

		mark(t, label) { this.events.push({ t, label }); }

		clear() { this.data = []; this.events = []; }

		draw(o) {
			const tEnd = Math.max(o.t, 60), tStart = tEnd - this.span;
			const rows = this.data.filter(r => r.t >= tStart);
			const ink = cssVar('--muted') || '#667';
			const grid = cssVar('--line') || '#ddd';
			const evColor = cssVar('--accent') || '#0b6e82';
			this.series.forEach((s, i) => {
				const c = this.cells[i];
				c.value.textContent = s.keys.map((k, j) => o[k].toFixed(s.dec) + (j === s.keys.length - 1 ? ' ' + s.unit : '')).join(' / ');
				const { ctx, w, h } = setupCanvas(c.canvas);
				ctx.clearRect(0, 0, w, h);
				let lo = Infinity, hi = -Infinity;
				rows.forEach(r => s.keys.forEach(k => { lo = Math.min(lo, r[k]); hi = Math.max(hi, r[k]); }));
				if (s.min !== undefined) lo = Math.min(lo, s.min);
				if (s.max !== undefined) hi = Math.max(hi, s.max);
				if (!isFinite(lo)) { lo = 0; hi = 1; }
				const pad = Math.max((hi - lo) * 0.12, s.minSpan || 1);
				lo -= pad; hi += pad;
				const X = t => (t - tStart) / (tEnd - tStart) * w;
				const Y = v => 4 + (1 - (v - lo) / (hi - lo)) * (h - 16);
				//grid
				ctx.strokeStyle = grid; ctx.lineWidth = 1;
				ctx.beginPath(); ctx.moveTo(0, h - 12.5); ctx.lineTo(w, h - 12.5); ctx.stroke();
				ctx.fillStyle = ink;
				ctx.font = '10px "IBM Plex Mono", ui-monospace, monospace';
				ctx.fillText(hi.toFixed(s.dec), 2, 11);
				ctx.fillText(lo.toFixed(s.dec), 2, h - 15);
				//threshold band
				if (s.limit !== undefined) {
					ctx.setLineDash([3, 3]);
					ctx.strokeStyle = cssVar('--warn');
					ctx.beginPath(); ctx.moveTo(0, Y(s.limit)); ctx.lineTo(w, Y(s.limit)); ctx.stroke();
					ctx.setLineDash([]);
				}
				//events
				this.events.forEach(ev => {
					if (ev.t < tStart) return;
					ctx.strokeStyle = evColor; ctx.globalAlpha = 0.55;
					ctx.beginPath(); ctx.moveTo(X(ev.t) + 0.5, 0); ctx.lineTo(X(ev.t) + 0.5, h - 12); ctx.stroke();
					ctx.globalAlpha = 1;
				});
				//lines
				s.keys.forEach((k, j) => {
					const color = cssVar(s.colors[j]);
					ctx.strokeStyle = color;
					ctx.lineWidth = 1.6;
					ctx.beginPath();
					rows.forEach((r, idx) => { const x = X(r.t), y = Y(r[k]); if (idx) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
					ctx.stroke();
					if (rows.length) {
						const r = rows[rows.length - 1];
						ctx.fillStyle = color;
						ctx.beginPath(); ctx.arc(X(r.t), Y(r[k]), 2.5, 0, 2 * Math.PI); ctx.fill();
					}
				});
				//time axis
				ctx.fillStyle = ink;
				const mins = this.span / 60;
				ctx.fillText('−' + mins + ' min', 2, h - 2);
				ctx.textAlign = 'right'; ctx.fillText('ora', w - 2, h - 2); ctx.textAlign = 'left';
			});
		}
	}

	/*
	 * Small sparkline used by the node inspector
	 */
	function sparkline(canvas, rows, key, color) {
		const { ctx, w, h } = setupCanvas(canvas);
		ctx.clearRect(0, 0, w, h);
		if (rows.length < 2) return;
		let lo = Infinity, hi = -Infinity;
		rows.forEach(r => { lo = Math.min(lo, r[key]); hi = Math.max(hi, r[key]); });
		const pad = Math.max((hi - lo) * 0.15, Math.abs(hi) * 0.02 + 1e-3);
		lo -= pad; hi += pad;
		const t0 = rows[0].t, t1 = rows[rows.length - 1].t || 1;
		const X = t => (t - t0) / ((t1 - t0) || 1) * (w - 6) + 1, Y = v => 3 + (1 - (v - lo) / (hi - lo)) * (h - 6);
		ctx.beginPath();
		rows.forEach((r, i) => { if (i) ctx.lineTo(X(r.t), Y(r[key])); else ctx.moveTo(X(r.t), Y(r[key])); });
		ctx.strokeStyle = color; ctx.lineWidth = 1.6; ctx.stroke();
		ctx.lineTo(X(t1), h); ctx.lineTo(X(t0), h); ctx.closePath();
		ctx.globalAlpha = 0.12; ctx.fillStyle = color; ctx.fill(); ctx.globalAlpha = 1;
		const last = rows[rows.length - 1];
		ctx.beginPath(); ctx.arc(X(last.t), Y(last[key]), 3, 0, 2 * Math.PI); ctx.fillStyle = color; ctx.fill();
	}

	global.BreatheMonitor = { Monitor, Trends, sparkline, cssVar };
})(window);
