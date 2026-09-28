/*
 * NodeSim 3D - application: model loop, editable nodes, side monitor
 */
(function () {
	'use strict';

	const { PhysiologyModel, DEFAULT_PATIENT, DEFAULT_VENTILATOR } = window.BreathePhysiology;
	const C = window.BreatheNodes;
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
		const v = C.nodeValue(n, out);
		$('card-val').textContent = fmtNode(v, n);
		$('card-unit').textContent = n.unitFn ? n.unitFn(out) : n.unit;
		$('card-sub').textContent = n.subFn ? n.subFn(out) : '';
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
	const MEAS = [
		['Ppicco', o => o.ppeak, 0, 'cmH₂O'], ['Pplat', o => o.pplat, 0, 'cmH₂O'], ['PEEP tot', o => o.peepTot, 1, 'cmH₂O'],
		['VT', o => o.vt, 0, 'mL'], ['FR', o => o.rr, 0, '/min'], ['ΔP', o => o.dp, 0, 'cmH₂O']
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
		measEls.forEach(e => { e.v.textContent = e.m[1](out).toFixed(e.m[2]); });
		vitalEls.forEach(e => {
			e.v.textContent = e.vt[1](out);
			e.u.textContent = typeof e.vt[2] === 'function' ? e.vt[2](out) : e.vt[2];
			const st = C.nodeStatus(C.byId[e.vt[4]], out);
			e.v.parentElement.classList.toggle('alarm', st === 'crit');
		});
		const ov = out.override;
		const inf = model.S.infusion > 0;
		$('status').textContent = ov ? 'Insufflazione sostenuta in corso: ' + Math.ceil(ov.remaining) + ' s' : inf ? 'Infusione in corso: ' + Math.round(model.S.infusion) + ' mL rimanenti' : '';
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
		if (selected) openCard(selected);
	}

	let lastFrame = null, acc = 0, lastUi = 0, lastUiSimT = 0;
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
		monitor = new window.BreatheMonitor.Monitor($('monitor'));
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

	window.NodeSim3D = { get model() { return model; }, get out() { return out; }, select: id => space.select(id, true), edit: (id, v) => applyEdit(id, editFor(id), v) };
	init();
})();
