/*
 * BREATHE NodeSim - ventilator console
 *
 * Realistic ventilator waveforms (pressure, flow, volume) and the two classic hold maneuvers of
 * ICU ventilators (the keys "Insp. hold" and "Exp. hold" of Dräger Evita/Infinity):
 *  - inspiratory hold: at the end of inspiration both valves close, flow stops and airway pressure
 *    falls from the peak to the plateau (Pplat), the alveolar pressure at end inspiration;
 *  - expiratory hold: at the end of expiration both valves close and airway pressure rises from the
 *    set PEEP to the total PEEP, revealing intrinsic PEEP (PEEPi) and the trapped volume.
 *
 * Each breath is integrated on a single-compartment RC lung (resistance R, compliance Crs) around
 * the operating point computed by the physiology model, with the ventilator acting as a flow source
 * (VC: constant flow, then end-inspiratory pause) or a pressure source (PC and pressure support,
 * with rise time; pressure support cycles off at 25% of peak flow). Expiration is passive through
 * the expiratory valve. The breath is played in wall-clock time; the model keeps running meanwhile.
 *
 * BreathPlayer has no DOM dependency (it is tested in Node); VentConsole draws it on a canvas.
 */
(function (global) {
	'use strict';

	const DT = 0.005;            // integration step of a breath (s)
	const R_VALVE = 2.5;         // expiratory valve and circuit (cmH2O/L/s)
	const ESENS = 0.25;          // pressure support: expiratory trigger at 25% of peak flow

	/*
	 * One breath from the model output o. Returns arrays sampled every DT for inspiration and
	 * expiration: airway pressure (cmH2O), flow (L/min) and volume above the end-expiratory volume
	 * at set PEEP (mL).
	 */
	function buildBreath(o) {
		const pe = o.x.peepE;
		if (o.mode === 'SI' || !(o.rr > 0)) {
			const p = o.mode === 'SI' ? o.pplat : pe;
			return { flat: true, p, dur: 1, pe, V0: 0, C: Math.max(5, o.crs), ti: 0, te: 1 };
		}
		const C = Math.max(5, o.crs);             // mL/cmH2O
		const R = Math.max(2, o.raw);              // cmH2O/L/s
		const mode = o.mode;
		const V0 = Math.max(0, o.autoPeep) * C;    // trapped volume at the start of the breath
		let V = V0;
		const ttot = o.ti + o.te;
		const insp = { p: [], f: [], v: [] }, exp = { p: [], f: [], v: [] };
		let ppeak = pe, peakFlow = 0, tiEff = o.ti, pauseAt = null, pStart = 0, flowEnd = 0;
		const F = (o.x.flowLs || 0) * 1000;       // VC set flow, mL/s
		const vtTarget = o.vt;
		for (let t = 0; t < o.ti - 1e-9; t += DT) {
			const palv = pe + V / C;
			let paw, flow;
			if (mode === 'VC') {
				const left = vtTarget - (V - V0);
				if (left > 0.5 && pauseAt === null) {
					flow = Math.min(F * (1 - Math.exp(-t / 0.025)), left / DT);
					paw = palv + R * flow / 1000;
					pStart = paw;
				} else {
					//end-inspiratory pause: fast resistive drop, then slow stress relaxation to the plateau
					if (pauseAt === null) pauseAt = t;
					const tp = t - pauseAt;
					flow = 0;
					paw = palv + (pStart - palv) * (0.82 * Math.exp(-tp / 0.04) + 0.18 * Math.exp(-tp / 0.5));
				}
			} else {
				const top = mode === 'PC' ? Math.max(o.pinsp, pe + 1) : pe + o.ps;
				const k = Math.min(1, t / Math.max(0.03, o.slope || 0.2));
				let cmd = pe + (top - pe) * (1 - Math.pow(1 - k, 2));
				let pm = 0;
				if (mode === 'CPAP') {
					pm = (o.x.pmus || 0) * Math.sin(Math.PI * Math.min(1, t / o.ti));
					if (t < 0.08) cmd = pe - 1.3 * Math.sin(Math.PI * t / 0.08); // patient trigger
				}
				flow = Math.max(0, (cmd + pm - palv) / R * 1000);
				paw = cmd;
				peakFlow = Math.max(peakFlow, flow);
				if (mode === 'CPAP' && t > 0.2 && flow < ESENS * peakFlow) { tiEff = t; break; }
			}
			ppeak = Math.max(ppeak, paw);
			flowEnd = flow;
			insp.p.push(paw); insp.f.push(flow * 0.06); insp.v.push(V - V0);
			V += flow * DT;
		}
		if (mode !== 'CPAP') tiEff = insp.p.length * DT;
		const vEndInsp = V;
		const teEff = Math.max(0.2, ttot - tiEff);
		for (let t = 0; t < teEff - 1e-9; t += DT) {
			const palv = pe + V / C;
			const flow = (pe - palv) / (R + R_VALVE) * 1000;   // mL/s, negative
			const paw = pe - R_VALVE * flow / 1000;
			exp.p.push(paw); exp.f.push(flow * 0.06); exp.v.push(V - V0);
			V += flow * DT;
		}
		//a plateau is measured on every breath when flow is zero at end inspiration
		const lastInspP = insp.p.length ? insp.p[insp.p.length - 1] : pe;
		const pauseLen = pauseAt === null ? 0 : tiEff - pauseAt;
		const autoPlat = mode === 'VC' ? (pauseLen >= 0.15 ? lastInspP : null)
			: (mode === 'PC' && flowEnd < 0.05 * Math.max(1, peakFlow) ? lastInspP : null);
		return {
			flat: false, mode, pe, C, R, V0, ti: tiEff, te: teEff, insp, exp, ppeak,
			vt: vEndInsp - V0, vEndInsp, vEndExp: V, flowEndInsp: flowEnd * 0.06, setFlow: F * 0.06, autoPlat
		};
	}

	/*
	 * Plays breaths one after the other and inserts the hold maneuvers. advance(dt, o) moves the
	 * playhead; the returned sample is { paw, flow, vol, phase }.
	 */
	class BreathPlayer {

		constructor() {
			this.seg = null;
			this.pending = null;     // requested hold { type, dur }
			this.results = { insp: null, exp: null };
			this.lastBreath = null;  // arrays of the last full breath (for loops)
			this.onHoldStart = null;
			this.onHoldEnd = null;
			this.simTime = 0;
		}

		requestHold(type, dur) {
			this.pending = { type, dur: Math.min(15, dur || (type === 'insp' ? 2 : 3)) };
			//an apnea or sustained inflation has no breath to hold
			if (this.seg && this.seg.b.flat) { this.pending = null; return false; }
			return true;
		}

		//Release a press-and-hold: end the hold now (at least 0.8 s of hold), or cap a pending one
		releaseHold(type) {
			const s = this.seg;
			if (s && s.kind === (type === 'insp' ? 'ihold' : 'ehold')) s.dur = Math.max(s.t, 0.8);
			else if (this.pending && this.pending.type === type) this.pending.dur = type === 'insp' ? 2 : 3;
		}

		isHolding() { return this.seg && (this.seg.kind === 'ihold' || this.seg.kind === 'ehold'); }

		start(o) {
			const b = buildBreath(o);
			this.seg = b.flat ? { kind: 'flat', t: 0, dur: b.dur, b } : { kind: 'insp', t: 0, dur: b.ti, b };
			this.cur = { p: [], v: [] };
		}

		transition(o) {
			const s = this.seg, b = s.b;
			const extra = s.t - s.dur;
			if (s.kind === 'insp') {
				if (this.pending && this.pending.type === 'insp') {
					const n = b.insp.p.length - 1;
					this.seg = { kind: 'ihold', t: extra, dur: this.pending.dur, b, pStart: b.insp.p[n], V: b.vEndInsp };
					this.pending = null;
					if (this.onHoldStart) this.onHoldStart('insp');
				} else this.seg = { kind: 'exp', t: extra, dur: b.te, b };
			} else if (s.kind === 'ihold') {
				const pplat = this.holdSample(s, s.dur).paw;
				const peepRef = this.results.exp && this.simTime - this.results.exp.at < 120 ? this.results.exp.peepTot : b.pe;
				const dp = pplat - peepRef;
				this.results.insp = {
					at: this.simTime, ppeak: b.ppeak, pplat, peepRef, peepRefMeasured: peepRef !== b.pe, dp,
					cstat: dp > 0.3 ? b.vt / dp : null,
					raw: b.mode === 'VC' ? (b.ppeak - pplat) / (b.setFlow / 60)
						: b.flowEndInsp > 3 ? (b.ppeak - pplat) / (b.flowEndInsp / 60) : null,
					vt: b.vt, dur: s.dur
				};
				if (this.onHoldEnd) this.onHoldEnd('insp', this.results.insp);
				this.seg = { kind: 'exp', t: extra, dur: b.te, b };
			} else if (s.kind === 'exp') {
				if (this.pending && this.pending.type === 'exp') {
					this.seg = { kind: 'ehold', t: extra, dur: this.pending.dur, b, V: b.vEndExp };
					this.pending = null;
					if (this.onHoldStart) this.onHoldStart('exp');
				} else this.next(o, extra);
			} else if (s.kind === 'ehold') {
				const peepTot = this.holdSample(s, s.dur).paw;
				const peepi = Math.max(0, peepTot - b.pe);
				this.results.exp = { at: this.simTime, peepTot, peepSet: b.pe, peepi, vtrap: peepi * b.C, dur: s.dur };
				if (this.onHoldEnd) this.onHoldEnd('exp', this.results.exp);
				this.next(o, extra);
			} else this.next(o, extra);
		}

		next(o, extra) {
			if (this.seg && !this.seg.b.flat) this.lastBreath = this.cur;
			this.start(o);
			this.seg.t = Math.max(0, extra);
		}

		holdSample(s, t) {
			const b = s.b;
			const palv = b.pe + s.V / b.C;
			if (s.kind === 'ihold') {
				return { paw: palv + (s.pStart - palv) * (0.82 * Math.exp(-t / 0.04) + 0.18 * Math.exp(-t / 0.5)), flow: 0, vol: s.V - b.V0 };
			}
			return { paw: b.pe + (palv - b.pe) * (1 - Math.exp(-t / 0.2)), flow: 0, vol: s.V - b.V0 };
		}

		sample() {
			const s = this.seg, b = s.b;
			if (s.kind === 'flat') return { paw: b.p, flow: 0, vol: 0, phase: 'flat' };
			if (s.kind === 'ihold' || s.kind === 'ehold') return Object.assign(this.holdSample(s, s.t), { phase: s.kind });
			const a = s.kind === 'insp' ? b.insp : b.exp;
			const n = a.p.length;
			if (!n) return { paw: b.pe, flow: 0, vol: 0, phase: s.kind };
			const x = Math.min(n - 1.001, s.t / DT);
			const i = Math.max(0, Math.floor(x)), f = x - i, j = Math.min(n - 1, i + 1);
			const lerp = arr => arr[i] + (arr[j] - arr[i]) * f;
			return { paw: lerp(a.p), flow: lerp(a.f), vol: lerp(a.v), phase: s.kind };
		}

		advance(dt, o) {
			this.simTime += dt;
			if (!this.seg) this.start(o);
			this.seg.t += dt;
			let guard = 0;
			while (this.seg.t >= this.seg.dur && guard++ < 20) this.transition(o);
			const smp = this.sample();
			this.cur.p.push(smp.paw); this.cur.v.push(smp.vol);
			if (this.cur.p.length > 4000) { this.cur.p.shift(); this.cur.v.shift(); }
			return smp;
		}
	}

	/* ------------------------------------------------------------------ drawing */

	function setupCanvas(canvas) {
		const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
		const w = canvas.clientWidth, h = canvas.clientHeight;
		if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
			canvas.width = Math.round(w * dpr);
			canvas.height = Math.round(h * dpr);
		}
		const ctx = canvas.getContext('2d');
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		return { ctx, w, h };
	}

	function niceCeil(v, step) { return Math.ceil(v / step) * step; }

	/*
	 * Canvas console: sweeping traces with grid and scales, hold maneuvers, freeze, P-V loop.
	 * opts: { abp: true to add the arterial pressure trace, loop: canvas for the P-V loop }
	 */
	class VentConsole {

		constructor(canvas, opts) {
			opts = opts || {};
			this.canvas = canvas;
			this.loopCanvas = opts.loop || null;
			this.window = opts.window || 10;
			this.player = new BreathPlayer();
			this.traces = [
				{ key: 'paw', label: 'Paw', unit: 'cmH₂O', color: '#f4c542', fill: true, min: 0, max: 30, step: 10 },
				{ key: 'flow', label: 'Flusso', unit: 'L/min', color: '#4fd4ef', min: -60, max: 60, step: 20, sym: true },
				{ key: 'vol', label: 'Volume', unit: 'mL', color: '#b98cff', fill: true, min: 0, max: 600, step: 200 }
			];
			if (opts.abp) this.traces.push({ key: 'abp', label: 'ABP', unit: 'mmHg', color: '#ff5d62', min: 40, max: 140, step: 20 });
			this.traces.forEach(t => { t.buf = []; t.shrink = 0; });
			this.cursor = 0;
			this.lastT = null;
			this.beatPhase = 0;
			this.frozenScreen = false;
			this.breathMeas = { vte: 0, pmean: 0 };
			this.acc = { sumP: 0, n: 0, vMax: 0 };
		}

		requestHold(type, dur) { return this.player.requestHold(type, dur); }
		releaseHold(type) { this.player.releaseHold(type); }
		get results() { return this.player.results; }
		set onHoldStart(f) { this.player.onHoldStart = f; }
		set onHoldEnd(f) { this.player.onHoldEnd = f; }
		toggleFreeze() { this.frozenScreen = !this.frozenScreen; return this.frozenScreen; }

		abpShape(ph) {
			if (ph < 0.12) return Math.sin(ph / 0.12 * Math.PI / 2);
			if (ph < 0.35) return 1 - 0.55 * (ph - 0.12) / 0.23;
			if (ph < 0.40) return 0.45 + 0.08 * Math.sin((ph - 0.35) / 0.05 * Math.PI);
			return 0.45 * Math.exp(-(ph - 0.40) * 2.2) * (1 - (ph - 0.4) * 0.2);
		}

		push(o, nowMs) {
			if (this.lastT === null) { this.lastT = nowMs; return; }
			const dt = Math.min(0.1, (nowMs - this.lastT) / 1000);
			this.lastT = nowMs;
			if (dt <= 0) return;
			const prevPhase = this.player.seg ? this.player.seg.kind : null;
			const smp = this.player.advance(dt, o);
			this.beatPhase = (this.beatPhase + dt * o.hr / 60) % 1;
			//small cardiogenic oscillations, visible when flow is low
			const beat = Math.sin(2 * Math.PI * this.beatPhase);
			const quiet = smp.phase !== 'insp' || o.mode !== 'VC' ? 1 : 0;
			const flow = smp.flow + (smp.phase === 'ihold' || smp.phase === 'ehold' ? 0 : quiet * 0.9 * beat * Math.exp(-Math.abs(smp.flow) / 8));
			const paw = smp.paw + 0.12 * beat;
			//per-breath measurements
			if (smp.phase === 'insp' && prevPhase !== 'insp' && prevPhase !== null) {
				if (this.acc.n) this.breathMeas = { vte: this.acc.vMax - Math.max(0, this.acc.vEnd || 0), pmean: this.acc.sumP / this.acc.n };
				this.acc = { sumP: 0, n: 0, vMax: 0 };
			}
			this.acc.sumP += smp.paw; this.acc.n++; this.acc.vMax = Math.max(this.acc.vMax, smp.vol); this.acc.vEnd = smp.vol;
			//arterial pressure with respiratory modulation
			const b = this.player.seg.b;
			const tBreath = smp.phase === 'insp' || smp.phase === 'ihold' ? 0.25 : 0.75;
			const resp = o.rr > 0 ? Math.sin(2 * Math.PI * tBreath - 0.6) * (smp.vol / Math.max(50, b.vt || 400)) : 0;
			const pp = (o.sbp - o.dbp) * (1 + resp * o.ppv / 200);
			const abp = o.dbp + pp * this.abpShape(this.beatPhase) + resp * o.ppv * 0.05;
			this.lastValues = { paw, flow, vol: smp.vol, abp, phase: smp.phase };
			if (this.frozenScreen) return;
			this.cursor = (this.cursor + dt / this.window) % 1;
			const keepAfter = nowMs - this.window * 1000 * 0.97;
			this.traces.forEach(tr => {
				tr.buf.push({ x: this.cursor, v: this.lastValues[tr.key], tw: nowMs, ph: smp.phase });
				while (tr.buf.length && tr.buf[0].tw < keepAfter) tr.buf.shift();
			});
		}

		//Scales follow the settings: they grow at once and shrink only after a few seconds
		rescale(o, dt) {
			const b = this.player.seg ? this.player.seg.b : null;
			const want = {
				paw: [o.mode === 'CPAP' ? -5 : 0, Math.max(20, niceCeil(Math.max(o.ppeak, o.pplat, o.peepTot) + 6, 10))],
				flow: (() => {
					let fmax = 40;
					if (b && !b.flat) fmax = Math.max(fmax, ...b.insp.f.map(Math.abs), ...b.exp.f.map(Math.abs));
					fmax = niceCeil(fmax * 1.1, 20);
					return [-fmax, fmax];
				})(),
				vol: [0, Math.max(300, niceCeil((b && b.vt ? b.vt : o.vt) * 1.25, 100))],
				abp: [Math.max(0, Math.floor((o.dbp - 25) / 20) * 20), Math.max(120, niceCeil(o.sbp + 15, 20))]
			};
			this.traces.forEach(tr => {
				const [lo, hi] = want[tr.key];
				if (hi > tr.max || lo < tr.min) { tr.max = Math.max(hi, tr.max); tr.min = Math.min(lo, tr.min); tr.shrink = 0; }
				if (hi < tr.max * 0.75 || lo > tr.min * 0.75 + (tr.key === 'abp' ? 10 : 0)) {
					tr.shrink += dt;
					if (tr.shrink > 3) { tr.max = hi; tr.min = lo; tr.shrink = 0; }
				} else tr.shrink = 0;
				tr.step = tr.key === 'vol' ? (tr.max > 800 ? 400 : 200) : tr.key === 'flow' ? (tr.max > 80 ? 40 : 20) : tr.key === 'abp' ? 40 : (tr.max > 40 ? 20 : 10);
			});
		}

		draw(o) {
			const { ctx, w, h } = setupCanvas(this.canvas);
			const now = performance.now();
			this.rescale(o, this.lastDraw ? (now - this.lastDraw) / 1000 : 0);
			this.lastDraw = now;
			ctx.fillStyle = '#04070a';
			ctx.fillRect(0, 0, w, h);
			const n = this.traces.length, gap = 4;
			const bandH = (h - gap * (n - 1)) / n;
			const left = 44;
			ctx.font = '600 11px "IBM Plex Sans Condensed", "Arial Narrow", sans-serif';
			//vertical time grid, one line per second
			ctx.strokeStyle = 'rgba(255,255,255,0.045)';
			ctx.lineWidth = 1;
			for (let s = 1; s < this.window; s++) {
				const x = left + (w - left) * s / this.window;
				ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, 0); ctx.lineTo(Math.round(x) + 0.5, h); ctx.stroke();
			}
			this.traces.forEach((tr, i) => {
				const y0 = i * (bandH + gap);
				const ymap = v => y0 + 4 + (1 - (v - tr.min) / (tr.max - tr.min)) * (bandH - 8);
				const X = x => left + x * (w - left);
				//band background and horizontal grid with scale
				ctx.fillStyle = 'rgba(255,255,255,0.018)';
				ctx.fillRect(left, y0, w - left, bandH);
				ctx.font = '500 10px "IBM Plex Mono", ui-monospace, monospace';
				ctx.textAlign = 'right';
				//at least ~16 px between scale labels
				let step = tr.step;
				while (step / (tr.max - tr.min) * (bandH - 8) < 16) step *= 2;
				for (let v = Math.ceil(tr.min / step) * step; v <= tr.max + 1e-9; v += step) {
					const y = Math.round(ymap(v)) + 0.5;
					ctx.strokeStyle = v === 0 ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.07)';
					ctx.setLineDash(v === 0 ? [] : [2, 4]);
					ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(w, y); ctx.stroke();
					ctx.fillStyle = 'rgba(255,255,255,0.45)';
					ctx.fillText(String(v), left - 6, Math.min(y0 + bandH - 2, Math.max(y0 + 9, y + 3.5)));
				}
				ctx.setLineDash([]);
				ctx.textAlign = 'left';
				//label
				ctx.font = '600 11px "IBM Plex Sans Condensed", "Arial Narrow", sans-serif';
				ctx.fillStyle = tr.color;
				ctx.fillText(tr.label, left + 6, y0 + 13);
				ctx.fillStyle = 'rgba(255,255,255,0.4)';
				ctx.fillText(tr.unit, left + 6 + ctx.measureText(tr.label).width + 6, y0 + 13);
				//trace, split where the sweep wraps around
				const segs = [];
				let cur = null, prevX = null;
				tr.buf.forEach(p => {
					const x = X(p.x);
					if (prevX === null || x < prevX) { cur = []; segs.push(cur); }
					cur.push({ x, y: ymap(Math.max(tr.min, Math.min(tr.max, p.v))), ph: p.ph });
					prevX = x;
				});
				const base = ymap(Math.max(tr.min, Math.min(tr.max, 0)));
				segs.forEach(sg => {
					if (tr.fill && sg.length > 1) {
						ctx.beginPath();
						ctx.moveTo(sg[0].x, base);
						sg.forEach(p => ctx.lineTo(p.x, p.y));
						ctx.lineTo(sg[sg.length - 1].x, base);
						ctx.closePath();
						ctx.globalAlpha = 0.16; ctx.fillStyle = tr.color; ctx.fill(); ctx.globalAlpha = 1;
					}
					ctx.beginPath();
					sg.forEach((p, k) => { if (k) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); });
					ctx.strokeStyle = tr.color; ctx.lineWidth = 1.7; ctx.lineJoin = 'round';
					ctx.stroke();
				});
				//hold maneuvers are marked on the pressure trace
				if (tr.key === 'paw') {
					let run = null;
					const flush = () => {
						if (!run) return;
						ctx.fillStyle = 'rgba(255,255,255,0.08)';
						ctx.fillRect(run.x0, y0, run.x1 - run.x0, bandH);
						ctx.fillStyle = '#fff';
						ctx.font = '600 10px "IBM Plex Sans Condensed", "Arial Narrow", sans-serif';
						ctx.fillText(run.ph === 'ihold' ? 'PAUSA INSP.' : 'PAUSA ESP.', run.x0 + 4, y0 + bandH - 6);
						run = null;
					};
					let px = null;
					tr.buf.forEach(p => {
						const x = X(p.x);
						const hold = p.ph === 'ihold' || p.ph === 'ehold';
						if (px !== null && x < px) flush();
						if (hold) { if (!run || run.ph !== p.ph) { flush(); run = { x0: x, x1: x, ph: p.ph }; } run.x1 = x; }
						else flush();
						px = x;
					});
					flush();
				}
			});
			//sweep bar
			const cx = left + this.cursor * (w - left);
			ctx.fillStyle = this.frozenScreen ? 'rgba(79,212,239,0.0)' : 'rgba(255,255,255,0.18)';
			ctx.fillRect(cx, 0, 2, h);
			if (this.frozenScreen) {
				ctx.fillStyle = 'rgba(79,212,239,0.9)';
				ctx.font = '700 11px "IBM Plex Sans Condensed", "Arial Narrow", sans-serif';
				ctx.textAlign = 'right';
				ctx.fillText('SCHERMO CONGELATO', w - 8, 13);
				ctx.textAlign = 'left';
			}
			if (this.loopCanvas && this.loopCanvas.clientWidth) this.drawLoop();
		}

		//Pressure-volume loop: last complete breath in grey, current breath in color
		drawLoop() {
			const { ctx, w, h } = setupCanvas(this.loopCanvas);
			ctx.fillStyle = '#04070a';
			ctx.fillRect(0, 0, w, h);
			const tp = this.traces[0], tv = this.traces[2];
			const pad = 26;
			const X = p => pad + (p - tp.min) / (tp.max - tp.min) * (w - pad - 8);
			const Y = v => h - pad + 8 - (v - 0) / (tv.max - 0) * (h - pad - 8);
			ctx.strokeStyle = 'rgba(255,255,255,0.1)';
			ctx.beginPath(); ctx.moveTo(pad, 6); ctx.lineTo(pad, h - pad + 8); ctx.lineTo(w - 6, h - pad + 8); ctx.stroke();
			ctx.font = '500 10px "IBM Plex Mono", ui-monospace, monospace';
			ctx.fillStyle = 'rgba(255,255,255,0.45)';
			ctx.fillText(String(tv.max), 2, 14);
			ctx.fillText('0', pad - 10, h - pad + 12);
			ctx.textAlign = 'right';
			ctx.fillText(tp.max + ' cmH₂O', w - 6, h - 6);
			ctx.textAlign = 'left';
			ctx.fillStyle = '#b98cff';
			ctx.font = '600 11px "IBM Plex Sans Condensed", "Arial Narrow", sans-serif';
			ctx.fillText('Loop P-V', pad + 6, 16);
			const drawSet = (set, color, width) => {
				if (!set || set.p.length < 2) return;
				ctx.beginPath();
				set.p.forEach((p, i) => { const x = X(p), y = Y(set.v[i]); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
				ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
			};
			drawSet(this.player.lastBreath, 'rgba(255,255,255,0.28)', 1.4);
			drawSet(this.player.cur, '#f4c542', 1.8);
		}
	}

	const api = { buildBreath, BreathPlayer, VentConsole };
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
	else global.BreatheConsole = api;
})(typeof window !== 'undefined' ? window : globalThis);
