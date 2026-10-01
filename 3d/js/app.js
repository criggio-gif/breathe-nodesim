/*
 * NodeSim 3D - application: model loop, editable nodes, side monitor
 */
(function () {
	'use strict';

	const { PhysiologyModel, DEFAULT_PATIENT, DEFAULT_VENTILATOR } = window.BreathePhysiology;
	const C = window.BreatheNodes;
		const { VentConsole, BreathPlayer, drawPV } = window.BreatheConsole;
		const FREEZABLE = new Set(window.BreathePhysiology.FREEZABLE);
	const $ = id => document.getElementById(id);
	const clone = o => JSON.parse(JSON.stringify(o));

	const PRESETS = [
		{ id: 'ards', label: 'ARDS moderata', conditions: { 'ARDS': { LeftLungSeverity: 0.6, RightLungSeverity: 0.6 } },
			ventilator: { mode: 'VC', TidalVolume: 450, RespirationRate: 20, PositiveEndExpiratoryPressure: 5, FractionInspiredOxygen: 0.6, InspiratoryPeriod: 0.9, Flow: 50 } },
		{ id: 'healthy', label: 'Polmone sano in anestesia', conditions: {},
			ventilator: { mode: 'VC', TidalVolume: 500, RespirationRate: 12, PositiveEndExpiratoryPressure: 5, FractionInspiredOxygen: 0.4, InspiratoryPeriod: 1.0, Flow: 60 } },
		{ id: 'ards-hypo', label: 'ARDS grave + ipovolemia', patient: { Volemia: 0.85 }, conditions: { 'ARDS': { LeftLungSeverity: 0.85, RightLungSeverity: 0.85 } },
			ventilator: { mode: 'VC', TidalVolume: 430, RespirationRate: 24, PositiveEndExpiratoryPressure: 8, FractionInspiredOxygen: 0.8, InspiratoryPeriod: 0.8, Flow: 50 } },
		{ id: 'copd', label: 'BPCO riacutizzata', conditions: { 'COPD': { BronchitisSeverity: 0.7, LeftLungEmphysemaSeverity: 0.6, RightLungEmphysemaSeverity: 0.6 } },
			ventilator: { mode: 'VC', TidalVolume: 500, RespirationRate: 22, PositiveEndExpiratoryPressure: 5, FractionInspiredOxygen: 0.35, InspiratoryPeriod: 1.2, Flow: 50 } },
		{ id: 'abdomen', label: 'ARDS extrapolmonare (addome teso)', patient: { IntraAbdominalPressure: 20 }, conditions: { 'ARDS': { LeftLungSeverity: 0.5, RightLungSeverity: 0.5 } },
			ventilator: { mode: 'VC', TidalVolume: 450, RespirationRate: 20, PositiveEndExpiratoryPressure: 8, FractionInspiredOxygen: 0.6, InspiratoryPeriod: 0.9, Flow: 50 } },
		{ id: 'lvd', label: 'Scompenso sistolico con edema', patient: { Volemia: 1.15 },
			conditions: { 'Chronic Ventricular Systolic Disfunction': { Severity: 0.8 }, 'ARDS': { LeftLungSeverity: 0.3, RightLungSeverity: 0.3 } },
			ventilator: { mode: 'VC', TidalVolume: 480, RespirationRate: 18, PositiveEndExpiratoryPressure: 5, FractionInspiredOxygen: 0.6, InspiratoryPeriod: 1.0, Flow: 50 } }
	];

	/* ------------------------------------------------------------ editable nodes */

	const cond = (name, keys) => ({
		get: m => (m.conditions[name] ? m.conditions[name][keys[0]] : 0) || 0,
		set: (m, v) => { if (v <= 0) m.setCondition(name, null); else { const c = {}; keys.forEach(k => { c[k] = v; }); m.setCondition(name, c); } }
	});
	const act = name => ({ get: m => m.actions[name] || 0, set: (m, v) => m.setAction(name, v) });
	const vent = key => ({ get: m => m.ventilator[key], set: (m, v) => m.setVentilator({ [key]: v }) });

	const EDIT = {
		peep: Object.assign({ label: 'PEEP', unit: 'cmH₂O', min: 0, max: 24, step: 1 }, vent('PositiveEndExpiratoryPressure')),
		insp: m => m.ventilator.mode === 'PC' ? Object.assign({ label: 'Pressione inspiratoria (PIP)', unit: 'cmH₂O', min: 5, max: 50, step: 1 }, vent('InspiratoryPressure'))
			: m.ventilator.mode === 'CPAP' ? Object.assign({ label: 'Pressione di supporto', unit: 'cmH₂O', min: 0, max: 25, step: 1 }, vent('DeltaPressureSupport'))
			: Object.assign({ label: 'Volume corrente impostato', unit: 'mL', min: 200, max: 1000, step: 10 }, vent('TidalVolume')),
		rr: Object.assign({ label: 'Frequenza impostata', unit: 'atti/min', min: 4, max: 40, step: 1 }, vent('RespirationRate')),
		ti: Object.assign({ label: 'Tempo inspiratorio', unit: 's', min: 0.4, max: 3, step: 0.1 }, vent('InspiratoryPeriod')),
		fio2: { label: 'FiO₂', unit: '%', min: 21, max: 100, step: 1, get: m => Math.round(m.ventilator.FractionInspiredOxygen * 100), set: (m, v) => m.setVentilator({ FractionInspiredOxygen: v / 100 }) },
		raw: Object.assign({ label: 'Broncocostrizione', unit: '', min: 0, max: 1, step: 0.05 }, act('Bronchoconstriction')),
		ccw: { label: 'Peso (BMI, parete toracica)', unit: 'kg', min: 40, max: 180, step: 1, get: m => m.patient.Weight, set: (m, v) => m.setPatient({ Weight: v }) },
		lungdz: Object.assign({ label: 'Gravità ARDS', unit: '', min: 0, max: 1, step: 0.05 }, cond('ARDS', ['LeftLungSeverity', 'RightLungSeverity'])),
		volemia: { label: 'Volemia', unit: '%', min: 60, max: 140, step: 1, get: m => Math.round(m.patient.Volemia * 100), set: (m, v) => m.setPatient({ Volemia: v / 100 }) },
		iap: { label: 'Pressione intra-addominale', unit: 'mmHg', min: 0, max: 30, step: 1, get: m => m.patient.IntraAbdominalPressure, set: (m, v) => m.setPatient({ IntraAbdominalPressure: v }) },
		contract: Object.assign({ label: 'Disfunzione sistolica VS', unit: '', min: 0, max: 1, step: 0.05 }, cond('Chronic Ventricular Systolic Disfunction', ['Severity'])),
		hb: Object.assign({ label: 'Anemia (fattore di riduzione)', unit: '', min: 0, max: 0.4, step: 0.02 }, cond('Chronic Anemia', ['ReductionFactor'])),
		shunt: Object.assign({ label: 'Shunt polmonare (patologia)', unit: '', min: 0, max: 1, step: 0.05 }, cond('Pulmonary Shunt', ['Severity'])),
		symp: Object.assign({ label: 'Stress acuto', unit: '', min: 0, max: 1, step: 0.05 }, act('Acute Stress'))
	};
	const editFor = id => (typeof EDIT[id] === 'function' ? EDIT[id](model) : EDIT[id]);
	const decOf = step => (String(step).split('.')[1] || '').length;

	/* ------------------------------------------------------------ state */

	let model, out, ref, space, monitor;
	let running = true, speed = 1, selected = null;

	const fmtTime = t => { t = Math.max(0, Math.floor(t)); return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0'); };
	const fmtNode = (v, n) => isFinite(v) ? v.toFixed(n.dec).replace('-', '−') : '–';
	const snapshot = o => { const s = Object.assign({}, o); delete s.wave; delete s.x; return s; };

	function toast(text) {
		const el = $('toast');
		el.textContent = text;
		el.hidden = false;
		el.classList.remove('show');
		void el.offsetWidth;
		el.classList.add('show');
		clearTimeout(toast.timer);
		toast.timer = setTimeout(() => { el.hidden = true; }, 3200);
	}

	//Apply an edit: remember the state before, then send the cascade through the graph
	function applyEdit(nodeId, spec, value) {
		const before = spec.get(model);
		if (Math.abs(value - before) < 1e-9) return;
		ref = snapshot(out);
		spec.set(model, value);
		space.cascade(nodeId, value > before ? 1 : -1);
		const d = decOf(spec.step);
		toast(spec.label + ' ' + (+before).toFixed(d) + ' → ' + (+value).toFixed(d) + (spec.unit ? ' ' + spec.unit : ''));
		renderVent();
	}

	/* ------------------------------------------------------------ node card */

	function upstreamEditable(id) {
		const found = [], seen = new Set([id]);
		let frontier = [id];
		while (frontier.length && found.length < 5) {
			const next = [];
			frontier.forEach(f => C.byId[f].in.forEach(([s]) => {
				if (seen.has(s)) return;
				seen.add(s);
				if (EDIT[s]) found.push(s);
				next.push(s);
			}));
			frontier = next;
		}
		return found.slice(0, 5);
	}

	function chip(id, text) {
		const b = document.createElement('button');
		b.type = 'button';
		b.className = 'chip';
		b.textContent = text || C.byId[id].label;
		b.style.setProperty('--chip', window.Space3DColors[C.byId[id].cat]);
		b.addEventListener('click', () => space.select(id, true));
		return b;
	}

	function openCard(id) {
		selected = id;
		const card = $('card');
		if (!id) { card.hidden = true; return; }
		const n = C.byId[id];
		card.hidden = false;
		card.classList.remove('enter');
		void card.offsetWidth;
		card.classList.add('enter');
		$('card-dot').style.background = window.Space3DColors[n.cat];
		$('card-cat').textContent = C.CATEGORIES[n.cat].label;
		$('card-title').textContent = n.labelFn ? n.labelFn(out) : n.label;
		$('card-desc').textContent = n.desc;
		$('card-simple').textContent = n.simple || '';
		$('card-power').hidden = !FREEZABLE.has(id);

		const edit = $('card-edit');
		edit.innerHTML = '';
		const spec = editFor(id);
		if (spec) {
			const d = decOf(spec.step);
			const idIn = 'edit-' + id;
			edit.innerHTML = '<div class="edit-top"><label for="' + idIn + '"></label><output></output></div><input type="range" id="' + idIn + '">';
			edit.querySelector('label').textContent = spec.label;
			const input = edit.querySelector('input'), outEl = edit.querySelector('output');
			Object.assign(input, { min: spec.min, max: spec.max, step: spec.step, value: spec.get(model) });
			const show = () => { outEl.textContent = (+input.value).toFixed(d) + (spec.unit ? ' ' + spec.unit : ''); };
			show();
			input.addEventListener('input', show);
			input.addEventListener('change', () => applyEdit(id, spec, +input.value));
			edit.classList.remove('calc');
		} else {
			edit.classList.add('calc');
			edit.innerHTML = '<p>Valore calcolato dal modello: si modifica agendo sui parametri a monte.</p><div class="chips"></div>';
			const box = edit.querySelector('.chips');
			const ups = upstreamEditable(id);
			if (ups.length) ups.forEach(u => box.append(chip(u, (EDIT[u].label || C.byId[u].label)))); else edit.querySelector('p').textContent = 'Valore calcolato dal modello.';
		}

		const links = $('card-links');
		links.innerHTML = '';
		const add = (title, list) => {
			if (!list.length) return;
			const h = document.createElement('h3');
			h.textContent = title;
			const row = document.createElement('div');
			row.className = 'chips';
			list.forEach(([o, sign]) => {
				const c = chip(o);
				c.dataset.sign = sign;
				c.prepend(Object.assign(document.createElement('span'), { className: 'sgn', textContent: sign === '-' ? '−' : sign }));
				row.append(c);
			});
			links.append(h, row);
		};
		add('Dipende da', n.in);
		add('Influenza', n.out);
		updateCard();
	}

	function updateCard() {
		if (!selected) return;
		const n = C.byId[selected];
		const off = selected in model.frozen;
		$('card').classList.toggle('node-off', off);
		$('card-power').textContent = off ? '⏻ Riattiva nodo' : '⏻ Disattiva nodo';
		$('card-power').setAttribute('aria-pressed', off);
		$('card-power').classList.toggle('is-off', off);
		const v = C.nodeValue(n, out);
		$('card-val').textContent = fmtNode(v, n);
		$('card-unit').textContent = n.unitFn ? n.unitFn(out) : n.unit;
		$('card-sub').textContent = off ? 'Nodo disattivato: valore fisso, non risente dei nodi a monte' : n.subFn ? n.subFn(out) : '';
		const delta = $('card-delta');
		if (ref) {
			const dv = v - C.nodeValue(n, ref);
			const sig = Math.abs(dv) >= Math.max(Math.pow(10, -n.dec) * 0.5, Math.abs(C.nodeValue(n, ref)) * 0.01);
			delta.textContent = sig ? (dv > 0 ? '▲ ' : '▼ ') + Math.abs(dv).toFixed(n.dec) : '';
			delta.className = 'card-delta ' + (sig ? (dv > 0 ? 'up' : 'down') : '');
		}
	}

	/* ------------------------------------------------------------ side panel */

	const VENT_TILES = [
		{ id: 'peep', label: 'PEEP', val: o => o.peepSet, d: 0, unit: 'cmH₂O' },
		{ id: 'insp', label: o => o.mode === 'PC' ? 'Pinsp' : o.mode === 'CPAP' ? 'PS' : 'VT', val: o => o.mode === 'PC' ? o.pinsp : o.mode === 'CPAP' ? o.ps : o.vtSet, d: 0, unit: o => o.mode === 'VC' ? 'mL' : 'cmH₂O' },
		{ id: 'rr', label: 'FR', val: o => o.rrSet, d: 0, unit: '/min' },
		{ id: 'fio2', label: 'FiO₂', val: o => o.fio2 * 100, d: 0, unit: '%' },
		{ id: 'ti', label: 'Ti', val: o => o.ti, d: 1, unit: 's' }
	];
	//Measured values as on an ICU ventilator: Pplat when a plateau exists or after an inspiratory
	//hold; PEEPi and Cstat only after the hold maneuvers (valid for 3 minutes)
	const HOLD_VALID = 180;
	const holdRes = type => {
		const r = monitor && monitor.results[type];
		return r && monitor.player.simTime - r.at < HOLD_VALID ? r : null;
	};
	const autoPlat = () => { const b = monitor && monitor.player.seg ? monitor.player.seg.b : null; return b && b.autoPlat != null ? b.autoPlat : null; };
	const MEAS = [
		['Ppicco', o => o.ppeak.toFixed(0)],
		['Pplat', () => { const a = autoPlat(); if (a != null) return a.toFixed(0); const r = holdRes('insp'); return r ? r.pplat.toFixed(0) : '—'; }],
		['Pmedia', o => o.mpaw.toFixed(0)],
		['PEEPi', () => { const r = holdRes('exp'); return r ? r.peepi.toFixed(1) : '—'; }],
		['Cstat', () => { const r = holdRes('insp'); return r && r.cstat ? r.cstat.toFixed(0) : '—'; }],
		['VTe', o => o.vt.toFixed(0)]
	];
	const VITALS = [
		['FC', o => o.hr.toFixed(0), 'bpm', '#46d68c', 'hr'], ['PA', o => o.sbp.toFixed(0) + '/' + o.dbp.toFixed(0), o => '(' + o.map.toFixed(0) + ') mmHg', '#ff5d62', 'map'],
		['SpO₂', o => o.spo2.toFixed(0), '%', '#5cc8f0', 'spo2'], ['EtCO₂', o => o.etco2.toFixed(0), 'mmHg', '#f4c542', 'etco2'],
		['GC', o => o.co.toFixed(1), 'L/min', '#ff9f6b', 'co'], ['PVC', o => o.rap.toFixed(0), 'mmHg', '#b9a4ff', 'rap'],
		['PaO₂', o => o.pao2.toFixed(0), 'mmHg', '#5cc8f0', 'pao2'], ['PaCO₂', o => o.paco2.toFixed(0), 'mmHg', '#f4c542', 'paco2'],
		['Lattato', o => o.lactate.toFixed(1), 'mmol/L', '#ffb14a', 'lactate']
	];

	let tileEls = [], measEls = [], vitalEls = [];

	function buildSide() {
		const set = $('vent-set');
		tileEls = VENT_TILES.map(t => {
			const b = document.createElement('button');
			b.type = 'button';
			b.className = 'tile';
			b.innerHTML = '<span class="tile-l"></span><span class="tile-v"></span><span class="tile-u"></span>';
			b.addEventListener('click', () => space.select(t.id, true));
			set.append(b);
			return { t, l: b.querySelector('.tile-l'), v: b.querySelector('.tile-v'), u: b.querySelector('.tile-u') };
		});
		const meas = $('vent-meas');
		measEls = MEAS.map(m => {
			const d = document.createElement('div');
			d.className = 'meas';
			d.innerHTML = '<span class="meas-l"></span><span class="meas-v"></span>';
			d.querySelector('.meas-l').textContent = m[0];
			meas.append(d);
			return { m, v: d.querySelector('.meas-v') };
		});
		const vit = $('vitals');
		vitalEls = VITALS.map(vt => {
			const b = document.createElement('button');
			b.type = 'button';
			b.className = 'vital';
			b.style.setProperty('--vc', vt[3]);
			b.innerHTML = '<span class="vital-l"></span><span class="vital-v"></span><span class="vital-u"></span>';
			b.querySelector('.vital-l').textContent = vt[0];
			b.addEventListener('click', () => space.select(vt[4], true));
			vit.append(b);
			return { vt, v: b.querySelector('.vital-v'), u: b.querySelector('.vital-u') };
		});
		document.querySelectorAll('#mode button').forEach(b => b.addEventListener('click', () => {
			if (b.dataset.mode === model.ventilator.mode) return;
			ref = snapshot(out);
			const before = model.ventilator.mode;
			model.setVentilator({ mode: b.dataset.mode });
			if (b.dataset.mode === 'CPAP' && model.patient.Sedation > 0.8) model.setPatient({ Sedation: 0.3 });
			space.cascade('insp', 0);
			toast('Modalità ' + before + ' → ' + b.dataset.mode);
			renderVent();
			if (selected) openCard(selected);
		}));
	}

	function renderVent() {
		document.querySelectorAll('#mode button').forEach(b => {
			const on = b.dataset.mode === model.ventilator.mode;
			b.classList.toggle('on', on);
			b.setAttribute('aria-checked', on);
		});
	}

	function updateSide() {
		tileEls.forEach(e => {
			const t = e.t;
			e.l.textContent = typeof t.label === 'function' ? t.label(out) : t.label;
			e.v.textContent = t.val(out).toFixed(t.d);
			e.u.textContent = typeof t.unit === 'function' ? t.unit(out) : t.unit;
		});
		measEls.forEach(e => { e.v.textContent = e.m[1](out); });
				$('vent-mode-label').textContent = out.mode === 'SI' ? (out.override && out.override.type === 'PV' ? 'CURVA P-V' : 'RECLUTAMENTO') : out.mode === 'CPAP' ? 'CPAP/ASB' : out.mode + (model.ventilator.AssistedMode === 0 ? '-AC' : '-CMV');
				syncOff();
		vitalEls.forEach(e => {
			e.v.textContent = e.vt[1](out);
			e.u.textContent = typeof e.vt[2] === 'function' ? e.vt[2](out) : e.vt[2];
			const st = C.nodeStatus(C.byId[e.vt[4]], out);
			e.v.parentElement.classList.toggle('alarm', st === 'crit');
		});
		const ov = out.override;
		const inf = model.S.infusion > 0;
		$('status').textContent = ov ? (ov.type === 'PV' ? 'Curva P-V in corso: ' : 'Insufflazione sostenuta in corso: ') + Math.ceil(ov.remaining) + ' s' : inf ? 'Infusione in corso: ' + Math.round(model.S.infusion) + ' mL rimanenti' : '';
		$('clock').textContent = fmtTime(out.t);
	}

	/* ------------------------------------------------------------ scenario & loop */

	function loadPreset(id) {
		const p = PRESETS.find(x => x.id === id) || PRESETS[0];
		model = new PhysiologyModel({
			patient: Object.assign({}, DEFAULT_PATIENT, p.patient || {}),
			ventilator: Object.assign({}, DEFAULT_VENTILATOR, p.ventilator || {}),
			conditions: clone(p.conditions || {})
		});
		out = model.out;
		ref = snapshot(out);
		renderVent();
		if (pvPanel && !pvPanel.hidden) renderPV();
		if (selected) openCard(selected);
	}

	let lastFrame = null, acc = 0, lastUi = 0, lastUiSimT = 0, lastPvT = 0, pvWatch = false;
	let pvPanel = null, pvCanvas = null;
	function frame(now) {
		if (lastFrame === null) lastFrame = now;
		const realDt = Math.min(0.1, (now - lastFrame) / 1000);
		lastFrame = now;
		if (running) {
			const h = speed <= 5 ? 0.1 : 0.25;
			acc += realDt * speed;
			let guard = 0;
			while (acc >= h && guard++ < 300) { out = model.step(h); acc -= h; }
			if (guard >= 300) acc = 0;
		}
		monitor.push(out, now);
		monitor.draw(out);
		if (!pvPanel.hidden) {
			drawPV(pvCanvas, model.pv);
			if (model.pv && model.pv.running && now - lastPvT > 250) { lastPvT = now; renderPV(); }
		}
		if (pvWatch && model.pv && !model.pv.running) {
			pvWatch = false;
			renderPV();
			const r = model.pv.result;
			if (r) toast('Curva P-V: LIP ' + (r.lip === null ? 'non evidente' : r.lip) + ', UIP ' + (r.uip === null ? 'non evidente' : r.uip) + ' cmH₂O');
		}
		if (now - lastUi > 250) {
			lastUi = now;
			space.setValues(out, ref, out.t - lastUiSimT, fmtNode);
			lastUiSimT = out.t;
			updateSide();
			updateCard();
		}
		space.frame(realDt);
		requestAnimationFrame(frame);
	}

	function init() {
		if (!window.THREE || !window.THREE.OrbitControls) {
			$('space').insertAdjacentHTML('beforeend', '<p class="fatal">Non riesco a caricare la libreria 3D (Three.js). Controlla la connessione e ricarica la pagina.</p>');
			return;
		}
		space = new window.Space3D($('space-canvas'), $('labels'), C, openCard);
		monitor = new VentConsole($('monitor'), { abp: true, loop: $('loop'), window: 8 });
		pvPanel = $('pv-panel'); pvCanvas = $('pv-canvas');
		wireConsole();
		wireView();
		$('card-power').addEventListener('click', () => { if (selected) toggleNode(selected); });
		const sel = $('scenario');
		PRESETS.forEach(p => sel.append(new Option(p.label, p.id)));
		sel.addEventListener('change', () => { loadPreset(sel.value); toast('Scenario: ' + sel.options[sel.selectedIndex].text); });
		buildSide();
		loadPreset('ards');

		$('card-close').addEventListener('click', () => space.select(null, true));
		$('play').addEventListener('click', () => {
			running = !running;
			$('play').innerHTML = running ? '&#10074;&#10074;' : '&#9654;';
			$('play').setAttribute('aria-label', running ? 'Pausa' : 'Riprendi');
		});
		document.querySelectorAll('#speed button').forEach(b => b.addEventListener('click', () => {
			speed = +b.dataset.speed;
			document.querySelectorAll('#speed button').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', x === b); });
		}));
		$('act-rm').addEventListener('click', () => {
			ref = snapshot(out);
			model.startSustainedInflation(40, 30);
			space.cascade('peeptot', 1);
			toast('Reclutamento: 40 cmH₂O per 30 s');
		});
		$('act-fluid').addEventListener('click', () => {
			ref = snapshot(out);
			model.fluidBolus(500, 300);
			space.cascade('volemia', 1);
			toast('Bolo di fluidi 500 mL in 5 min');
		});
		$('act-bleed').addEventListener('click', () => {
			ref = snapshot(out);
			model.hemorrhage(500);
			space.cascade('volemia', -1);
			toast('Emorragia 500 mL');
		});
		requestAnimationFrame(frame);
	}

	/* ------------------------------------------------------------ switched-off nodes, view, settings */

	function toggleNode(id) {
		if (!FREEZABLE.has(id)) return false;
		const n = C.byId[id];
		const wasOff = id in model.frozen;
		model.setNodeEnabled(id, wasOff);
		const v = C.nodeValue(n, out);
		toast(wasOff ? 'Nodo riattivato: ' + n.label : 'Nodo disattivato: ' + n.label + ' fisso a ' + fmtNode(v, n) + ' ' + (n.unitFn ? n.unitFn(out) : n.unit));
		syncOff();
		updateCard();
		return true;
	}

	function syncOff() {
		const ids = Object.keys(model.frozen);
		space.setOff(ids);
		$('btn-all-on').disabled = !ids.length;
		$('btn-all-on').textContent = ids.length ? 'Riattiva tutti i nodi (' + ids.length + ')' : 'Riattiva tutti i nodi';
	}

	const PREFS_KEY = 'nodesim3d-prefs';
	let prefs = { view: 'full', formulas: false };
	try { prefs = Object.assign(prefs, JSON.parse(localStorage.getItem(PREFS_KEY) || '{}')); } catch (e) { /* storage unavailable */ }
	const savePrefs = () => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) { /* storage unavailable */ } };

	function setView(v) {
		prefs.view = v === 'console' ? 'console' : 'full';
		savePrefs();
		const consoleMode = prefs.view === 'console';
		document.querySelector('.shell').classList.toggle('console-mode', consoleMode);
		//the top bar (scenario, time, view, settings) follows the visible area
		const hud = document.querySelector('.hud-top');
		if (consoleMode) $('side').prepend(hud); else $('space').append(hud);
		document.querySelectorAll('#view-mode button').forEach(b => {
			const on = b.dataset.view === prefs.view;
			b.classList.toggle('on', on);
			b.setAttribute('aria-checked', on);
		});
		requestAnimationFrame(() => space.resize());
	}

	function wireView() {
		document.querySelectorAll('#view-mode button').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));
		const menu = $('settings-menu'), btn = $('btn-settings');
		const close = () => { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
		btn.addEventListener('click', ev => { ev.stopPropagation(); menu.hidden = !menu.hidden; btn.setAttribute('aria-expanded', String(!menu.hidden)); });
		document.addEventListener('click', ev => { if (!menu.hidden && !menu.contains(ev.target)) close(); });
		document.addEventListener('keydown', ev => { if (ev.key === 'Escape') close(); });
		$('set-formulas').checked = prefs.formulas;
		document.body.classList.toggle('show-formulas', prefs.formulas);
		$('set-formulas').addEventListener('change', ev => { prefs.formulas = ev.target.checked; savePrefs(); document.body.classList.toggle('show-formulas', prefs.formulas); });
		$('btn-all-on').addEventListener('click', () => {
			const ids = Object.keys(model.frozen);
			ids.forEach(id => model.setNodeEnabled(id, true));
			if (ids.length) toast('Riattivati ' + ids.length + ' nodi');
			syncOff();
			updateCard();
		});
		setView(prefs.view);
	}

	/* ------------------------------------------------------------ ventilator console */

	function renderHoldResults() {
		const ri = holdRes('insp'), re = holdRes('exp');
		const row = (l, v, u) => '<div class="hr-row"><span>' + l + '</span><b>' + v + '</b><i>' + u + '</i></div>';
		let html = '<h3>Manovre di pausa</h3>';
		if (!ri && !re) html += '<p class="hint">Premi <b>Pausa insp.</b> o <b>Pausa esp.</b>: i valori misurati compaiono qui.</p>';
		if (ri) html += row('Pplat', ri.pplat.toFixed(1), 'cmH₂O') + row('ΔP', ri.dp.toFixed(1), 'cmH₂O') +
			row('Cstat', ri.cstat ? ri.cstat.toFixed(0) : '—', 'mL/cmH₂O') + row('R', ri.raw ? ri.raw.toFixed(1) : '—', 'cmH₂O/L/s');
		if (re) html += row('PEEP tot', re.peepTot.toFixed(1), 'cmH₂O') + row('PEEPi', re.peepi.toFixed(1), 'cmH₂O') + row('V intrappolato', re.vtrap.toFixed(0), 'mL');
		$('hold-results').innerHTML = html;
	}

	const holdLabel = type => type === 'insp' ? 'Pausa inspiratoria' : 'Pausa espiratoria';

	function startHold(type, dur) {
		if (!monitor.requestHold(type, dur)) { $('hold-status').textContent = 'Nessun respiro da mettere in pausa'; return false; }
		$(type === 'insp' ? 'hold-insp' : 'hold-exp').classList.add('armed');
		$('hold-status').textContent = holdLabel(type) + ': in attesa della fine ' + (type === 'insp' ? 'dell’inspirazione' : 'dell’espirazione') + '…';
		$('hold-status').className = 'vent-status busy';
		return true;
	}

	function wireConsole() {
		const status = $('hold-status');
		monitor.onHoldStart = type => { status.textContent = holdLabel(type) + ' in corso: valvole chiuse'; status.className = 'vent-status busy'; };
		monitor.onHoldEnd = (type, r) => {
			status.textContent = type === 'insp'
				? 'Pplat ' + r.pplat.toFixed(1) + ' · ΔP ' + r.dp.toFixed(1) + ' cmH₂O' + (r.cstat ? ' · Cstat ' + r.cstat.toFixed(0) : '') + (r.raw ? ' · R ' + r.raw.toFixed(1) : '')
				: 'PEEP tot ' + r.peepTot.toFixed(1) + ' · PEEPi ' + r.peepi.toFixed(1) + ' cmH₂O · Vtrap ' + r.vtrap.toFixed(0) + ' mL';
			status.className = 'vent-status done';
			document.querySelectorAll('.vkey').forEach(b => b.classList.remove('armed'));
			renderHoldResults();
			toast(holdLabel(type) + ' completata');
			space.cascade(type === 'insp' ? 'pplat' : 'autopeep', 0);
		};
		[['hold-insp', 'insp'], ['hold-exp', 'exp']].forEach(([id, type]) => {
			const b = $(id);
			let pressed = false;
			b.addEventListener('pointerdown', ev => { if (ev.button !== 0) return; pressed = true; startHold(type, 15); });
			const up = () => { if (pressed) { pressed = false; monitor.releaseHold(type); } };
			b.addEventListener('pointerup', up);
			b.addEventListener('pointerleave', up);
			b.addEventListener('click', ev => { if (ev.detail === 0) startHold(type); });
		});
		$('pv-key').addEventListener('click', () => openPV($('pv-panel').hidden));
		$('pv-close').addEventListener('click', () => openPV(false));
		$('pv-start').addEventListener('click', () => {
			if (model.pv && model.pv.running) { model.stopOverride(); toast('Curva P-V interrotta'); }
			else pvCurve();
			renderPV();
		});
		$('freeze').addEventListener('click', () => {
			const on = monitor.toggleFreeze();
			$('freeze').setAttribute('aria-pressed', on);
			$('freeze').classList.toggle('on', on);
		});
		renderHoldResults();
	}

	/* ------------------------------------------------------------ quasi-static P-V curve */

	function pvCurve(opts) {
		opts = opts || {};
		const peep = model.ventilator.PositiveEndExpiratoryPressure;
		const fromSel = opts.from !== undefined ? opts.from : $('pv-from').value;
		const from = Math.round(Math.min(20, Math.max(0, fromSel === 'peep' ? peep : +fromSel || 0)));
		const to = Math.round(Math.min(45, Math.max(from + 10, +(opts.to || $('pv-to').value) || 40)));
		const rate = Math.min(5, Math.max(1, +(opts.rate || $('pv-rate').value) || 2));
		ref = snapshot(out);
		model.startPVCurve({ from, to, rate });
		pvWatch = true;
		space.cascade('peeptot', 1);
		toast('Curva P-V: ' + from + ' → ' + to + ' cmH₂O, ' + Math.round(2 * (to - from) / rate) + ' s di apnea');
		openPV(true);
		return { from, to, rate };
	}

	function openPV(on) {
		$('pv-panel').hidden = !on;
		$('pv-key').classList.toggle('on', !!on);
		$('pv-key').setAttribute('aria-expanded', !!on);
		if (on) renderPV();
	}

	function renderPV() {
		const pv = model.pv;
		const box = $('pv-res'), st = $('pv-status');
		if (pv && pv.running) {
			const ov = model.override;
			st.textContent = (ov && ov.phase === 'esp' ? 'desufflazione' : 'insufflazione') + (ov ? ' · ' + ov.pressure.toFixed(0) + ' cmH₂O' : '');
		} else st.textContent = pv ? (pv.result ? 'completata' : 'interrotta') : '';
		$('pv-start').textContent = pv && pv.running ? 'Interrompi' : 'Avvia';
		const r = pv && pv.result;
		if (!r) {
			box.innerHTML = '<p class="hint">' + (pv && pv.running ? 'Manovra in corso: il paziente è in apnea.' : 'Apnea con rampa lenta di pressione, prima in salita e poi in discesa. Il ventilatore registra il volume a ogni pressione.') + '</p>';
			return;
		}
		const row = (label, val, title) => '<div class="hr-row"' + (title ? ' title="' + title + '"' : '') + '><span>' + label + '</span>' + (val === null ? '<span class="na">—</span>' : '<b>' + val + '</b>') + '</div>';
		const n = x => x === null ? null : (x % 1 ? x.toFixed(1) : String(x));
		box.innerHTML = row('LIP cmH₂O', n(r.lip), 'Flesso inferiore: incrocio tra la tangente iniziale e quella del tratto più ripido della branca di insufflazione')
			+ row('UIP cmH₂O', n(r.uip), 'Flesso superiore: incrocio tra la tangente del tratto più ripido e quella finale')
			+ row('PMC desuffl.', n(r.pmc), 'Punto di massima curvatura della desufflazione: dove le unità iniziano a richiudersi')
			+ row('C lineare', r.cLin.toFixed(0), 'mL/cmH₂O tra LIP e UIP')
			+ row('Isteresi mL', r.hyst.toFixed(0), 'Massima distanza tra desufflazione e insufflazione alla stessa pressione')
			+ row('V a ' + r.to + ' mL', r.vMax.toFixed(0))
			+ '<p class="hint">' + (r.lip === null ? 'Nessun flesso inferiore: poco polmone da reclutare. ' : 'Il flesso inferiore indica reclutamento: sotto, le unità sono chiuse. ')
			+ (r.uip === null ? 'Nessun flesso superiore entro ' + r.to + ' cmH₂O.' : 'Sopra ' + n(r.uip) + ' cmH₂O il polmone aerato si sovradistende.') + '</p>';
	}

	function measureHold(type) {
		const p = new BreathPlayer();
		let res = null;
		p.onHoldEnd = (t, r) => { res = r; };
		p.advance(0.001, out);
		p.requestHold(type, type === 'insp' ? 2 : 3);
		for (let t = 0; t < 40 && !res; t += 0.02) p.advance(0.02, out);
		return res;
	}

	window.NodeSim3D = {
		get model() { return model; }, get out() { return out; },
		select: id => space.select(id, true),
		edit: (id, v) => applyEdit(id, editFor(id), v),
		setNodeEnabled(id, enabled) { if ((id in model.frozen) === !enabled) return true; return toggleNode(id); },
		holdManeuver(type) { startHold(type); return measureHold(type); },
		pvCurve: opts => pvCurve(opts || { from: 0, to: 40, rate: 2 }),
		get pv() { return model.pv; },
		setView
	};
	init();
})();
