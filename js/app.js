/*
 * BREATHE NodeSim - application: controls, maneuvers, narrative, simulation loop
 */
(function () {
	'use strict';

	const { PhysiologyModel, DEFAULT_PATIENT, DEFAULT_VENTILATOR } = window.BreathePhysiology;
	const C = window.BreatheNodes;
	const { Trends, sparkline, cssVar } = window.BreatheMonitor;
		const { VentConsole, BreathPlayer, drawPV } = window.BreatheConsole;
		const FREEZABLE = new Set(window.BreathePhysiology.FREEZABLE);
	const $ = id => document.getElementById(id);
	const clone = o => JSON.parse(JSON.stringify(o));

	/* ------------------------------------------------------------ catalogs */

	//Conditions with the same names and parameters as breathe.engine data.Condition
	const CONDITIONS = [
		{ name: 'ARDS', label: 'ARDS', params: [{ label: 'Gravità (polmone sx = dx)', keys: ['LeftLungSeverity', 'RightLungSeverity'], min: 0, max: 1, step: 0.05, def: 0.6 }] },
		{ name: 'Pneumonia', label: 'Polmonite', params: [{ label: 'Gravità (polmone sx = dx)', keys: ['LeftLungSeverity', 'RightLungSeverity'], min: 0, max: 1, step: 0.05, def: 0.4 }] },
		{ name: 'COPD', label: 'BPCO', params: [
			{ label: 'Bronchite', keys: ['BronchitisSeverity'], min: 0, max: 1, step: 0.05, def: 0.6 },
			{ label: 'Enfisema (sx = dx)', keys: ['LeftLungEmphysemaSeverity', 'RightLungEmphysemaSeverity'], min: 0, max: 1, step: 0.05, def: 0.5 }] },
		{ name: 'Pulmonary Fibrosis', label: 'Fibrosi polmonare', params: [{ label: 'Gravità', keys: ['Severity'], min: 0, max: 1, step: 0.05, def: 0.5 }] },
		{ name: 'Pulmonary Shunt', label: 'Shunt polmonare', params: [{ label: 'Gravità', keys: ['Severity'], min: 0, max: 1, step: 0.05, def: 0.3 }] },
		{ name: 'Pericardial Effusion', label: 'Versamento pericardico', params: [{ label: 'Volume', unit: 'mL', keys: ['AccumulatedVolume'], min: 0, max: 1000, step: 25, def: 500 }] },
		{ name: 'Chronic Anemia', label: 'Anemia cronica', params: [{ label: 'Fattore di riduzione', keys: ['ReductionFactor'], min: 0, max: 0.4, step: 0.02, def: 0.2 }] },
		{ name: 'Chronic Ventricular Systolic Disfunction', label: 'Disfunzione sistolica VS', params: [{ label: 'Gravità', keys: ['Severity'], min: 0, max: 1, step: 0.05, def: 0.6 }] }
	];

	//Actions with the same names as breathe.engine data.Action
	const ACTIONS = [
		{ name: 'Bronchoconstriction', label: 'Broncocostrizione' },
		{ name: 'Airway Obstruction', label: 'Ostruzione delle vie aeree' },
		{ name: 'Acute Stress', label: 'Stress acuto' },
		{ name: 'Ventilator Leak', label: 'Perdita del circuito' }
	];

	//Ventilator fields per mode, as in breathe.web ventilators/*VentilatorPanel
	const VENT_FIELDS = {
		TidalVolume: { label: 'Volume corrente (VT)', unit: 'mL', min: 200, max: 1000, step: 10, dec: 0 },
		InspiratoryPressure: { label: 'Pressione inspiratoria (Pinsp)', unit: 'cmH₂O', min: 5, max: 50, step: 1, dec: 0 },
		DeltaPressureSupport: { label: 'Pressione di supporto (ΔPS)', unit: 'cmH₂O', min: 0, max: 25, step: 1, dec: 0 },
		PositiveEndExpiratoryPressure: { label: 'PEEP', unit: 'cmH₂O', min: 0, max: 24, step: 1, dec: 0 },
		RespirationRate: { label: 'Frequenza respiratoria (FR)', unit: 'atti/min', min: 4, max: 40, step: 1, dec: 0 },
		FractionInspiredOxygen: { label: 'FiO₂', unit: '', min: 0.21, max: 1, step: 0.01, dec: 2 },
		InspiratoryPeriod: { label: 'Tempo inspiratorio (Ti)', unit: 's', min: 0.4, max: 3, step: 0.1, dec: 1 },
		Flow: { label: 'Flusso inspiratorio', unit: 'L/min', min: 20, max: 120, step: 1, dec: 0 },
		Slope: { label: 'Slope (rampa)', unit: 's', min: 0, max: 1, step: 0.05, dec: 2 }
	};
	const MODE_FIELDS = {
		VC: ['TidalVolume', 'RespirationRate', 'PositiveEndExpiratoryPressure', 'FractionInspiredOxygen', 'InspiratoryPeriod', 'Flow'],
		PC: ['InspiratoryPressure', 'RespirationRate', 'PositiveEndExpiratoryPressure', 'FractionInspiredOxygen', 'InspiratoryPeriod', 'Slope'],
		CPAP: ['DeltaPressureSupport', 'PositiveEndExpiratoryPressure', 'FractionInspiredOxygen', 'Slope']
	};

	//Patient fields, as in breathe.web panels/PatientPanel
	const PATIENT_FIELDS = {
		Age: { label: 'Età', unit: 'anni', min: 18, max: 90, step: 1, dec: 0 },
		Weight: { label: 'Peso', unit: 'kg', min: 40, max: 180, step: 1, dec: 0 },
		Height: { label: 'Altezza', unit: 'cm', min: 145, max: 205, step: 1, dec: 0 },
		HeartRateBaseline: { label: 'FC basale', unit: 'bpm', min: 50, max: 110, step: 1, dec: 0 },
		SystolicArterialPressureBaseline: { label: 'PA sistolica basale', unit: 'mmHg', min: 90, max: 140, step: 1, dec: 0 },
		DiastolicArterialPressureBaseline: { label: 'PA diastolica basale', unit: 'mmHg', min: 55, max: 90, step: 1, dec: 0 },
		RespirationRateBaseline: { label: 'FR spontanea basale', unit: 'atti/min', min: 8, max: 25, step: 1, dec: 0 },
		BasalMetabolicRate: { label: 'Metabolismo basale', unit: 'kcal/die', min: 1000, max: 3000, step: 50, dec: 0 },
		Volemia: { label: 'Volemia', unit: '× norma', min: 0.6, max: 1.4, step: 0.05, dec: 2 },
		Sedation: { label: 'Sedazione (1 = nessuno sforzo spontaneo)', unit: '', min: 0, max: 1, step: 0.05, dec: 2 },
		IntraAbdominalPressure: { label: 'Pressione intra-addominale', unit: 'mmHg', min: 0, max: 30, step: 1, dec: 0 }
	};

	const PRESETS = [
		{ id: 'ards', label: 'ARDS moderata', desc: 'Polmone con ampia quota reclutabile, PEEP bassa. Prova ad alzare la PEEP o a fare un reclutamento, poi a riabbassarla.',
			conditions: { 'ARDS': { LeftLungSeverity: 0.6, RightLungSeverity: 0.6 } },
			ventilator: { mode: 'VC', TidalVolume: 450, RespirationRate: 20, PositiveEndExpiratoryPressure: 5, FractionInspiredOxygen: 0.6, InspiratoryPeriod: 0.9, Flow: 50 } },
		{ id: 'healthy', label: 'Polmone sano in anestesia', desc: 'Paziente standard di BREATHE, polmoni normali. La PEEP ha pochi benefici e solo costi emodinamici.',
			conditions: {}, ventilator: { mode: 'VC', TidalVolume: 500, RespirationRate: 12, PositiveEndExpiratoryPressure: 5, FractionInspiredOxygen: 0.4, InspiratoryPeriod: 1.0, Flow: 60 } },
		{ id: 'ards-hypo', label: 'ARDS grave + ipovolemia', desc: 'Lo scenario in cui la PEEP alta o il reclutamento fanno crollare la gittata: guarda PPV, PVC e DO₂. Prova poi un bolo di fluidi.',
			patient: { Volemia: 0.85 }, conditions: { 'ARDS': { LeftLungSeverity: 0.85, RightLungSeverity: 0.85 } },
			ventilator: { mode: 'VC', TidalVolume: 430, RespirationRate: 24, PositiveEndExpiratoryPressure: 8, FractionInspiredOxygen: 0.8, InspiratoryPeriod: 0.8, Flow: 50 } },
		{ id: 'copd', label: 'BPCO riacutizzata', desc: 'Resistenze alte e costante di tempo lunga: con FR alta compare auto-PEEP. Riduci FR o Ti e osserva PEEP totale e pressione arteriosa.',
			conditions: { 'COPD': { BronchitisSeverity: 0.7, LeftLungEmphysemaSeverity: 0.6, RightLungEmphysemaSeverity: 0.6 } },
			ventilator: { mode: 'VC', TidalVolume: 500, RespirationRate: 22, PositiveEndExpiratoryPressure: 5, FractionInspiredOxygen: 0.35, InspiratoryPeriod: 1.2, Flow: 50 } },
		{ id: 'lvd', label: 'Scompenso sistolico con edema', desc: 'Nel cuore insufficiente la pressione positiva riduce il postcarico del VS: la PEEP può migliorare gittata e ossigenazione.',
			patient: { Volemia: 1.15 }, conditions: { 'Chronic Ventricular Systolic Disfunction': { Severity: 0.8 }, 'ARDS': { LeftLungSeverity: 0.3, RightLungSeverity: 0.3 } },
			ventilator: { mode: 'VC', TidalVolume: 480, RespirationRate: 18, PositiveEndExpiratoryPressure: 5, FractionInspiredOxygen: 0.6, InspiratoryPeriod: 1.0, Flow: 50 } },
		{ id: 'obese', label: 'Obesità grave', desc: 'Parete toracica rigida e atelettasie da peso: la PEEP si trasmette molto alla pleura, ma serve per tenere aperto il polmone.',
			patient: { Weight: 140, Height: 170 }, conditions: {},
			ventilator: { mode: 'VC', TidalVolume: 450, RespirationRate: 16, PositiveEndExpiratoryPressure: 5, FractionInspiredOxygen: 0.5, InspiratoryPeriod: 1.0, Flow: 50 } },
		{ id: 'abdomen', label: 'ARDS extrapolmonare (addome teso)', desc: 'Sepsi addominale con pressione intra-addominale 20 mmHg: parete toracica rigida, basi collassate. La PEEP si trasmette molto alla pleura e al cuore: confronta con l’ARDS moderata.',
			patient: { IntraAbdominalPressure: 20 }, conditions: { 'ARDS': { LeftLungSeverity: 0.5, RightLungSeverity: 0.5 } },
			ventilator: { mode: 'VC', TidalVolume: 450, RespirationRate: 20, PositiveEndExpiratoryPressure: 8, FractionInspiredOxygen: 0.6, InspiratoryPeriod: 0.9, Flow: 50 } },
		{ id: 'tamponade', label: 'Versamento pericardico', desc: 'Il riempimento cardiaco è già limitato dal pericardio: anche piccoli aumenti di PEEP riducono molto la gittata.',
			conditions: { 'Pericardial Effusion': { AccumulatedVolume: 550 } },
			ventilator: { mode: 'VC', TidalVolume: 500, RespirationRate: 14, PositiveEndExpiratoryPressure: 5, FractionInspiredOxygen: 0.4, InspiratoryPeriod: 1.0, Flow: 60 } }
	];

	const TREND_SERIES = [
		{ label: 'PA media', keys: ['map'], unit: 'mmHg', dec: 0, colors: ['--c-hemo'], limit: 65, minSpan: 4 },
		{ label: 'Gittata cardiaca', keys: ['co'], unit: 'L/min', dec: 1, colors: ['--c-hemo'], minSpan: 0.3 },
		{ label: 'SpO₂', keys: ['spo2'], unit: '%', dec: 0, colors: ['--c-gas'], limit: 92, max: 100, minSpan: 1 },
		{ label: 'PaCO₂', keys: ['paco2'], unit: 'mmHg', dec: 0, colors: ['--c-gas'], minSpan: 2 },
		{ label: 'Pplat / PEEP tot', keys: ['pplat', 'peepTot'], unit: 'cmH₂O', dec: 0, colors: ['--c-mech', '--c-vent'], limit: 30, minSpan: 2 },
		{ label: 'Compliance', keys: ['crs'], unit: 'mL/cmH₂O', dec: 0, colors: ['--c-mech'], minSpan: 2 },
		{ label: 'Aerazione', keys: ['aeration'], unit: '%', dec: 0, colors: ['--c-mech'], minSpan: 2 },
		{ label: 'DO₂', keys: ['do2'], unit: 'mL/min', dec: 0, colors: ['--c-o2'], minSpan: 20 }
	];

	//Measured values as on an ICU ventilator: Pplat when a plateau exists (VC with pause) or after an
		//inspiratory hold; PEEPi, Cstat and R only after the hold maneuvers (valid for 3 minutes)
		const HOLD_VALID = 180;
		const holdRes = type => {
			const r = monitor && monitor.results[type];
			return r && monitor.player.simTime - r.at < HOLD_VALID ? r : null;
		};
		const dash = '—';
		const NUMERICS = [
			{ label: 'Ppicco', color: '#f4c542', val: o => o.ppeak.toFixed(0), unit: 'cmH₂O' },
			{ label: 'Pplat', color: '#f4c542', val: o => {
				const b = monitor && monitor.player.seg ? monitor.player.seg.b : null;
				if (b && b.autoPlat != null) return b.autoPlat.toFixed(0);
				const r = holdRes('insp');
				return r ? r.pplat.toFixed(0) : dash;
			}, sub: o => {
				const b = monitor && monitor.player.seg ? monitor.player.seg.b : null;
				return b && b.autoPlat != null ? '' : holdRes('insp') ? '(pausa)' : 'Pausa insp.';
			}, unit: 'cmH₂O' },
			{ label: 'Pmedia', color: '#f4c542', val: o => o.mpaw.toFixed(0), unit: 'cmH₂O' },
			{ label: 'PEEP', color: '#f4c542', val: o => o.x.peepE.toFixed(0), unit: 'cmH₂O' },
			{ label: 'PEEPi', color: '#f4c542', val: () => { const r = holdRes('exp'); return r ? r.peepi.toFixed(1) : dash; },
				sub: () => holdRes('exp') ? '' : 'Pausa esp.', unit: 'cmH₂O' },
			{ label: 'Cstat', color: '#f4c542', val: () => { const r = holdRes('insp'); return r && r.cstat ? r.cstat.toFixed(0) : dash; },
				sub: () => holdRes('insp') ? '' : 'Pausa insp.', unit: 'mL/cmH₂O' },
			{ label: 'VTe', color: '#5cc8f0', val: o => o.vt.toFixed(0), unit: 'mL' },
			{ label: 'VM', color: '#5cc8f0', val: o => (o.vt * o.rr / 1000).toFixed(1), unit: 'L/min' },
			{ label: 'FR', color: '#5cc8f0', val: o => o.rr.toFixed(0), unit: '/min' },
			{ label: 'FiO₂', color: '#5cc8f0', val: o => (o.fio2 * 100).toFixed(0), unit: '%' },
			{ label: 'FC', color: '#46d68c', val: o => o.hr.toFixed(0), unit: 'bpm', vital: true },
			{ label: 'ABP', color: '#ff5d62', val: o => o.sbp.toFixed(0) + '/' + o.dbp.toFixed(0), sub: o => '(' + o.map.toFixed(0) + ')', unit: 'mmHg', vital: true },
			{ label: 'SpO₂', color: '#5cc8f0', val: o => o.spo2.toFixed(0), unit: '%', vital: true },
			{ label: 'EtCO₂', color: '#f4c542', val: o => o.etco2.toFixed(0), unit: 'mmHg', vital: true },
			{ label: 'GC', color: '#ff9f6b', val: o => o.co.toFixed(1), unit: 'L/min', vital: true },
			{ label: 'PVC', color: '#b9a4ff', val: o => o.rap.toFixed(0), unit: 'mmHg', vital: true },
			{ label: 'PAPm', color: '#e7e3d4', val: o => o.mpap.toFixed(0), unit: 'mmHg', vital: true },
			{ label: 'PaO₂', color: '#5cc8f0', val: o => o.pao2.toFixed(0), unit: 'mmHg', vital: true }
		];

	//absolute significance thresholds for the narrative (others: 3% relative)
	const SIG = { spo2: 1, ph: 0.02, strain: 0.05, ti: 0.05, fio2: 1, hb: 0.3, lactate: 0.3, autopeep: 0.5, peeptot: 0.5, ppl: 0.5, rap: 0.7, pmsf: 0.5, vrg: 0.5, symp: 5, overdist: 3, ppv: 2, recruit: 2, shunt: 1.5, vdvt: 2, rvfunc: 3 };

	/* ------------------------------------------------------------ state */

	let model, out, reference, graph, monitor, trends, eqView;
	let running = true, speed = 1;
	let history = [];
	let events = [];
	let maneuver = null;
	let presetId = 'ards';
	const fieldUpdaters = [];

	const fmtTime = t => {
		t = Math.max(0, Math.floor(t));
		const h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = t % 60;
		return (h ? h + ':' + String(m).padStart(2, '0') : String(m).padStart(2, '0')) + ':' + String(s).padStart(2, '0');
	};
	const fmtNum = (v, dec) => isFinite(v) ? v.toFixed(dec).replace('-', '−') : '–';
	const snapshot = o => { const s = Object.assign({}, o); delete s.wave; return s; };

	/* ------------------------------------------------------------ controls */

	function slider(container, id, spec, get, onCommit) {
		const row = document.createElement('div');
		row.className = 'field';
		row.innerHTML = '<div class="field-top"><label for="' + id + '"></label><span class="field-val"><input type="number" id="' + id + '-n" aria-label=""><span class="unit"></span></span></div>' +
			'<input type="range" id="' + id + '">';
		row.querySelector('label').textContent = spec.label;
		row.querySelector('.unit').textContent = spec.unit || '';
		const range = row.querySelector('input[type=range]'), num = row.querySelector('input[type=number]');
		num.setAttribute('aria-label', spec.label);
		[range, num].forEach(i => { i.min = spec.min; i.max = spec.max; i.step = spec.step; });
		const set = v => { range.value = v; num.value = (+v).toFixed(spec.dec); };
		range.addEventListener('input', () => { num.value = (+range.value).toFixed(spec.dec); });
		range.addEventListener('change', () => onCommit(+range.value));
		num.addEventListener('change', () => {
			const v = Math.min(spec.max, Math.max(spec.min, +num.value));
			set(v); onCommit(v);
		});
		container.appendChild(row);
		const update = () => { if (document.activeElement !== range && document.activeElement !== num) set(get()); };
		update();
		return { row, update };
	}

	function buildVentFields() {
		const box = $('vent-fields');
		box.innerHTML = '';
		const v = model.ventilator;
		MODE_FIELDS[v.mode].forEach(key => {
			slider(box, 'v-' + key, VENT_FIELDS[key], () => model.ventilator[key], val => commitVent({ [key]: val }));
		});
		if (v.mode !== 'CPAP') {
			const row = document.createElement('div');
			row.className = 'field field-inline';
			row.innerHTML = '<label for="v-assist">Modalità</label><select id="v-assist"><option value="0">AC (assistita-controllata)</option><option value="1">CMV (controllata)</option></select>';
			const sel = row.querySelector('select');
			sel.value = String(v.AssistedMode);
			sel.addEventListener('change', () => commitVent({ AssistedMode: +sel.value }));
			box.appendChild(row);
		}
		document.querySelectorAll('#vent-mode button').forEach(b => {
			const on = b.dataset.mode === v.mode;
			b.classList.toggle('on', on);
			b.setAttribute('aria-checked', on);
		});
		syncPeepChips();
	}

	function syncVentUI() { buildVentFields(); }

	function syncPeepChips() {
		document.querySelectorAll('#peep-chips button').forEach(b =>
			b.classList.toggle('on', +b.dataset.peep === model.ventilator.PositiveEndExpiratoryPressure));
	}

	function describeVentChange(before, after) {
		const parts = [];
		if (before.mode !== after.mode) parts.push('Modalità ' + before.mode + ' → ' + after.mode);
		for (const k in VENT_FIELDS) {
			if (before[k] !== after[k] && MODE_FIELDS[after.mode].includes(k)) {
				const f = VENT_FIELDS[k];
				const short = k === 'PositiveEndExpiratoryPressure' ? 'PEEP' : f.label.replace(/ \(.*\)/, '');
				parts.push(short + ' ' + fmtNum(before[k], f.dec) + ' → ' + fmtNum(after[k], f.dec) + (f.unit ? ' ' + f.unit : ''));
			}
		}
		if (before.AssistedMode !== after.AssistedMode) parts.push(after.AssistedMode === 0 ? 'Modalità AC' : 'Modalità CMV');
		return parts.join(', ');
	}

	function commitVent(params, silent) {
		const before = clone(model.ventilator);
		model.setVentilator(params);
		let note = '';
		if (params.mode === 'CPAP' && model.patient.Sedation > 0.8) {
			model.setPatient({ Sedation: 0.3 });
			note = 'Sedazione ridotta a 0,3 per consentire il respiro spontaneo in CPAP.';
			fieldUpdaters.forEach(u => u());
		}
		const text = describeVentChange(before, model.ventilator);
		if (params.mode) buildVentFields(); else syncPeepChips();
		if (text && !silent) logEvent(text, note);
	}

	function buildPatientFields() {
		const box = $('patient-fields');
		box.innerHTML = '';
		const sexRow = document.createElement('div');
		sexRow.className = 'field field-inline';
		sexRow.innerHTML = '<label for="p-sex">Sesso</label><select id="p-sex"><option value="M">Maschio</option><option value="F">Femmina</option></select>';
		const sexSel = sexRow.querySelector('select');
		sexSel.value = model.patient.Sex;
		sexSel.addEventListener('change', () => { model.setPatient({ Sex: sexSel.value }); logEvent('Sesso: ' + (sexSel.value === 'M' ? 'maschio' : 'femmina')); });
		box.appendChild(sexRow);
		fieldUpdaters.length = 0;
		fieldUpdaters.push(() => { sexSel.value = model.patient.Sex; });
		for (const key in PATIENT_FIELDS) {
			const spec = PATIENT_FIELDS[key];
			const f = slider(box, 'p-' + key, spec, () => model.patient[key], val => {
				const old = model.patient[key];
				model.setPatient({ [key]: val });
				logEvent(spec.label.replace(/ \(.*\)/, '') + ' ' + fmtNum(old, spec.dec) + ' → ' + fmtNum(val, spec.dec) + (spec.unit ? ' ' + spec.unit : ''));
			});
			fieldUpdaters.push(f.update);
		}
	}

	function buildConditionFields() {
		const box = $('condition-fields');
		box.innerHTML = '';
		CONDITIONS.forEach((c, ci) => {
			const wrap = document.createElement('div');
			wrap.className = 'condition';
			const id = 'c-' + ci;
			wrap.innerHTML = '<label class="check" for="' + id + '"><input type="checkbox" id="' + id + '"><span></span><em class="engine-name"></em></label><div class="cond-params"></div>';
			wrap.querySelector('span').textContent = c.label;
			wrap.querySelector('.engine-name').textContent = c.name;
			const chk = wrap.querySelector('input');
			const params = wrap.querySelector('.cond-params');
			const current = () => model.conditions[c.name];
			const valueOf = p => { const cur = current(); return cur && cur[p.keys[0]] !== undefined ? cur[p.keys[0]] : p.def; };
			chk.checked = !!current();
			params.hidden = !chk.checked;
			c.params.forEach((p, pi) => {
				slider(params, id + '-' + pi, { label: p.label, unit: p.unit || '', min: p.min, max: p.max, step: p.step, dec: p.step < 0.1 ? 2 : p.step < 1 ? 1 : 0 },
					() => valueOf(p), val => {
						const cur = Object.assign({}, current() || {});
						p.keys.forEach(k => { cur[k] = val; });
						model.setCondition(c.name, cur);
						logEvent(c.label + ': ' + p.label.replace(/ \(.*\)/, '').toLowerCase() + ' ' + fmtNum(val, p.step < 1 ? 2 : 0) + (p.unit ? ' ' + p.unit : ''));
					});
			});
			chk.addEventListener('change', () => {
				if (chk.checked) {
					const cur = {};
					c.params.forEach(p => p.keys.forEach(k => { cur[k] = valueOf(p); }));
					model.setCondition(c.name, cur);
					logEvent(c.label + ' attivata');
				} else {
					model.setCondition(c.name, null);
					logEvent(c.label + ' rimossa');
				}
				params.hidden = !chk.checked;
			});
			box.appendChild(wrap);
		});
	}

	function buildActionFields() {
		const box = $('action-fields');
		box.innerHTML = '';
		ACTIONS.forEach((a, i) => {
			slider(box, 'a-' + i, { label: a.label + ' · ' + a.name, unit: '', min: 0, max: 1, step: 0.05, dec: 2 },
				() => model.actions[a.name] || 0, val => {
					model.setAction(a.name, val);
					logEvent(a.label + ' ' + (val > 0 ? 'gravità ' + val.toFixed(2) : 'risolta'));
				});
		});
	}

	function buildAllControls() {
		buildVentFields();
		buildPatientFields();
		buildConditionFields();
		buildActionFields();
	}

	/* ------------------------------------------------------------ presets & import */

	function loadPreset(id) {
		const p = PRESETS.find(x => x.id === id) || PRESETS[0];
		presetId = p.id;
		stopManeuver(true);
		model = new PhysiologyModel({
			patient: Object.assign({}, DEFAULT_PATIENT, p.patient || {}),
			ventilator: Object.assign({}, DEFAULT_VENTILATOR, p.ventilator || {}),
			conditions: clone(p.conditions || {})
		});
		restart('Scenario: ' + p.label);
		$('preset-desc').textContent = p.desc;
		$('preset').value = p.id;
	}

	function restart(label) {
		out = model.out;
		reference = snapshot(out);
		history = [];
		events = [];
		trends.clear();
		recordHistory();
		trends.record(out);
		buildAllControls();
		logEvent(label, '', true);
		updateUI(0);
	}

	function patientFromJson(json) {
		const p = json.InitialPatient || json.CurrentPatient || json.Patient || json;
		const scalar = key => {
			const f = p[key];
			if (!f || typeof f !== 'object') return null;
			const inner = Object.values(f)[0];
			return inner && inner.Value !== undefined ? { v: +inner.Value, u: inner.Unit || '' } : null;
		};
		const res = {};
		if (p.Name) res.Name = p.Name;
		if (p.Sex) res.Sex = String(p.Sex).toLowerCase().startsWith('f') ? 'F' : 'M';
		const age = scalar('Age'); if (age) res.Age = age.v;
		const h = scalar('Height');
		if (h) res.Height = h.u === 'in' ? h.v * 2.54 : h.u === 'm' ? h.v * 100 : h.u === 'ft' ? h.v * 30.48 : h.v;
		const w = scalar('Weight');
		if (w) res.Weight = w.u === 'lb' ? w.v * 0.4536 : w.u === 'g' ? w.v / 1000 : w.v;
		else if (res.Height) res.Weight = 21.75 * Math.pow(res.Height / 100, 2); // Pulse default BMI
		[['HeartRateBaseline'], ['SystolicArterialPressureBaseline'], ['DiastolicArterialPressureBaseline'], ['RespirationRateBaseline'], ['BasalMetabolicRate'], ['BodyFatFraction']]
			.forEach(([k]) => { const s = scalar(k); if (s) res[k] = s.v; });
		if (res.Height === undefined && res.Age === undefined && res.Weight === undefined) return null;
		['Height', 'Weight'].forEach(k => { if (res[k] !== undefined) res[k] = Math.round(res[k]); });
		return res;
	}

	function importFile(file) {
		const reader = new FileReader();
		reader.onload = () => {
			let parsed = null;
			try { parsed = patientFromJson(JSON.parse(reader.result)); } catch (e) { parsed = null; }
			if (!parsed) {
				$('import-msg').textContent = 'Il file non contiene dati paziente riconoscibili (servono almeno età, peso o altezza). Usa un file di resources/patients o di states.';
				return;
			}
			stopManeuver(true);
			model = new PhysiologyModel({
				patient: Object.assign({}, DEFAULT_PATIENT, parsed),
				ventilator: clone(model.ventilator),
				conditions: clone(model.conditions),
				actions: clone(model.actions)
			});
			$('import-msg').textContent = 'Importato: ' + (parsed.Name || file.name) + ' (' + Object.keys(parsed).filter(k => k !== 'Name').length + ' parametri).';
			restart('Paziente importato: ' + (parsed.Name || file.name));
		};
		reader.readAsText(file);
	}

	/* ------------------------------------------------------------ maneuvers */

	function runManeuver(m) {
		stopManeuver(true);
		m.i = -1; m.elapsed = 0; m.total = m.steps.reduce((a, s) => a + s.dur, 0);
		maneuver = m;
		$('maneuver-status').hidden = false;
		$('ms-name').textContent = m.name;
		if (m.start) m.start();
		nextStep();
	}

	function nextStep() {
		const m = maneuver;
		m.i++;
		if (m.i >= m.steps.length) {
			maneuver = null;
			$('maneuver-status').hidden = true;
			if (m.done) m.done();
			return;
		}
		m.tStep = 0;
		m.steps[m.i].start();
		syncVentUI();
	}

	function tickManeuver(dt) {
		const m = maneuver;
		if (!m) return;
		m.tStep += dt; m.elapsed += dt;
		const st = m.steps[m.i];
		if (m.tStep >= st.dur) {
			if (st.end) st.end();
			nextStep();
		}
	}

	function stopManeuver(silent) {
		if (!maneuver) return;
		const m = maneuver;
		maneuver = null;
		model.stopOverride();
		if (m.restore) m.restore();
		$('maneuver-status').hidden = true;
		syncVentUI();
		if (!silent) logEvent(m.name + ' interrotta');
	}

	function sustainedInflation(pressure, seconds) {
		const p = Math.round(Math.min(50, Math.max(20, +(pressure || $('si-p').value) || 40)));
		const t = Math.round(Math.min(60, Math.max(10, +(seconds || $('si-t').value) || 40)));
		$('si-p').value = p; $('si-t').value = t;
		runManeuver({
			name: 'Insufflazione sostenuta',
			steps: [{ label: 'CPAP ' + p + ' cmH₂O', dur: t, start: () => model.startSustainedInflation(p, t + 1), end: () => model.stopOverride() }],
			start: () => logEvent('Reclutamento: insufflazione sostenuta ' + p + ' cmH₂O × ' + t + ' s',
				'Durante la manovra la pressione pleurica sale: il ritorno venoso crolla, la PA scende e il barocettore alza la FC. In apnea la PaCO₂ sale. Al termine riprende la ventilazione con la PEEP impostata: se è sotto la pressione di chiusura degli alveoli appena aperti, il polmone ricollassa in pochi minuti.'),
			done: () => logEvent('Fine insufflazione, ripresa ventilazione (PEEP ' + model.ventilator.PositiveEndExpiratoryPressure + ')')
		});
	}

	/*
	 * Quasi-static P-V curve (low-flow P-V tool of ICU ventilators): apnea, airway pressure ramps from
	 * `from` to `to` and back at `rate` cmH2O/s; the panel shows the two limbs and the inflection points.
	 */
	function pvCurve(opts) {
		opts = opts || {};
		const peep = model.ventilator.PositiveEndExpiratoryPressure;
		const fromSel = opts.from !== undefined ? opts.from : $('pv-from').value;
		const from = Math.round(Math.min(20, Math.max(0, fromSel === 'peep' ? peep : +fromSel || 0)));
		const to = Math.round(Math.min(45, Math.max(from + 10, +(opts.to || $('pv-to').value) || 40)));
		const rate = Math.min(5, Math.max(1, +(opts.rate || $('pv-rate').value) || 2));
		const dur = 2 * (to - from) / rate;
		runManeuver({
			name: 'Curva P-V',
			steps: [{ label: 'Rampa ' + from + ' → ' + to + ' → ' + from + ' cmH₂O', dur: dur + 0.3, start: () => model.startPVCurve({ from, to, rate }) }],
			start: () => logEvent('Curva P-V quasi statica: ' + from + ' → ' + to + ' cmH₂O a ' + rate + ' cmH₂O/s (' + Math.round(dur) + ' s di apnea)',
				'La pressione sale lentamente, quindi il flusso è minimo e la pressione delle vie aeree è quella alveolare: la curva è statica. Durante la manovra il paziente è in apnea e la pressione intratoracica alta riduce il ritorno venoso.'),
			done: () => {
				renderPV();
				const r = model.pv && model.pv.result;
				if (r) logEvent(pvSummary(r), 'Il flesso inferiore (LIP) è dove il reclutamento accelera: sotto, molte unità sono chiuse. Il flesso superiore (UIP) è dove il tessuto aerato si irrigidisce (sovradistensione): la Pplat dovrebbe restarne sotto. La distanza tra le due branche (isteresi) è il volume reclutato dalla manovra, che resta aperto finché la pressione non scende sotto la pressione di chiusura.', true);
			}
		});
		openPV(true);
		return { from, to, rate, durationSeconds: Math.round(dur) };
	}

	const fmtP = x => x === null || x === undefined ? 'non evidente' : x.toFixed(x % 1 ? 1 : 0) + ' cmH₂O';
	function pvSummary(r) {
		return 'Curva P-V: LIP ' + fmtP(r.lip) + ', UIP ' + fmtP(r.uip) + ', compliance lineare ' + r.cLin.toFixed(0) + ' mL/cmH₂O, isteresi ' + r.hyst.toFixed(0) + ' mL';
	}

	function openPV(on) {
		$('pv-panel').hidden = !on;
		$('pv-key').classList.toggle('on', !!on);
		$('pv-key').setAttribute('aria-expanded', !!on);
		if (on) renderPV();
	}

	function renderPV() {
		const pv = model.pv;
		const box = $('pv-res');
		const st = $('pv-status');
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
			+ row('Isteresi mL', r.hyst.toFixed(0), 'Massima distanza tra desufflazione e insufflazione alla stessa pressione' + (r.hystP !== null ? ' (a ' + r.hystP + ' cmH₂O)' : ''))
			+ row('V a ' + r.to + ' mL', r.vMax.toFixed(0))
			+ '<p class="hint">' + (r.lip === null ? 'Nessun flesso inferiore: poco polmone da reclutare. ' : 'Il flesso inferiore indica reclutamento: sotto, le unità sono chiuse. ')
			+ (r.uip === null ? 'Nessun flesso superiore entro ' + r.to + ' cmH₂O.' : 'Sopra ' + n(r.uip) + ' cmH₂O il polmone aerato si sovradistende.') + '</p>';
	}

	function staircase() {
		const saved = clone(model.ventilator);
		const vt = saved.mode === 'VC' ? saved.TidalVolume : Math.round(6 * out.pbw / 10) * 10;
		const rr = saved.mode === 'CPAP' ? 20 : saved.RespirationRate;
		const results = [];
		const steps = [];
		[[20, 35], [25, 40], [30, 45]].forEach(([peep, pinsp]) => steps.push({
			label: 'Reclutamento PC: PEEP ' + peep + ', Pinsp ' + pinsp, dur: 30,
			start: () => model.setVentilator({ mode: 'PC', PositiveEndExpiratoryPressure: peep, InspiratoryPressure: pinsp, RespirationRate: rr, InspiratoryPeriod: 1.0, Slope: 0.2, AssistedMode: 1 })
		}));
		for (let peep = 24; peep >= 6; peep -= 2) steps.push({
			label: 'Titolazione VC: PEEP ' + peep, dur: 45,
			start: () => model.setVentilator({ mode: 'VC', TidalVolume: vt, RespirationRate: rr, Flow: saved.Flow || 50, InspiratoryPeriod: saved.mode === 'VC' ? saved.InspiratoryPeriod : 1.0, PositiveEndExpiratoryPressure: peep }),
			end: () => {
				const o = model.out;
				results.push({ peep, crs: o.crs, pplat: o.pplat, dp: o.dp, spo2: o.spo2, co: o.co, map: o.map, do2: o.do2 });
			}
		});
		steps.push({ label: 'Nuovo reclutamento: 40 cmH₂O × 30 s', dur: 30, start: () => model.startSustainedInflation(40, 31), end: () => model.stopOverride() });
		runManeuver({
			name: 'Reclutamento a scalini + PEEP decrementale',
			steps,
			start: () => logEvent('Reclutamento a scalini (PC, PEEP 20→30, ΔP 15) e titolazione decrementale della PEEP (24→6, VT ' + vt + ' mL)',
				'La PEEP ottimale è quella con la compliance più alta durante la discesa: sotto di essa il polmone inizia a ricollassare (derecruitment), sopra prevale la sovradistensione.'),
			restore: () => model.setVentilator(saved),
			done: () => {
				let best = results[0];
				results.forEach(r => { if (r.crs > best.crs + 0.5) best = r; });
				const target = Math.min(24, best.peep + 2);
				model.setVentilator(Object.assign({}, saved.mode === 'CPAP' ? { mode: 'VC', TidalVolume: vt, RespirationRate: rr } : saved, { PositiveEndExpiratoryPressure: target }));
				syncVentUI();
				logEvent('PEEP impostata a ' + target + ' cmH₂O (compliance massima a PEEP ' + best.peep + ', + 2)', '', false, { rows: results, best: best.peep });
			}
		});
	}

	/* ------------------------------------------------------------ narrative */

	function logEvent(text, note, silentRef, table) {
		const snap = snapshot(model.out || out);
		events.forEach(e => { if (!e.done) { e.done = true; e.final = snap; } });
		const ev = { t: model.t, text, note: note || '', snap, done: false, table };
		events.unshift(ev);
		if (events.length > 30) events.pop();
		if (!silentRef) trends.mark(model.t, text);
		reference = snap;
		renderEvents();
	}

	function significant(n, a, b) {
		const d = b - a;
		if (!isFinite(d) || d === 0) return false;
		if (SIG[n.id] !== undefined) return Math.abs(d) >= SIG[n.id];
		return Math.abs(d) / (Math.abs(a) + 1e-6) >= 0.03 && Math.abs(d) >= Math.pow(10, -n.dec);
	}

	const CAT_ORDER = ['vent', 'pat', 'mech', 'gas', 'hemo', 'o2'];

	function analyze(before, now) {
		const changes = [];
		C.NODES.forEach(n => {
			const a = C.nodeValue(n, before), b = C.nodeValue(n, now);
			if (significant(n, a, b)) changes.push({ n, a, b, d: b - a });
		});
		const map = new Map(changes.map(c => [c.n.id, c]));
		changes.forEach(c => {
			c.causes = c.n.in.filter(([s, sign]) => {
				const ci = map.get(s);
				if (!ci) return false;
				if (sign === '±') return true;
				return Math.sign(ci.d) * (sign === '+' ? 1 : -1) === Math.sign(c.d);
			}).map(([s]) => map.get(s));
		});
		changes.sort((x, y) => CAT_ORDER.indexOf(x.n.cat) - CAT_ORDER.indexOf(y.n.cat) || x.n.col - y.n.col || x.n.row - y.n.row);
		return changes;
	}

	function renderEvents() {
		const box = $('events');
		box.innerHTML = '';
		if (!events.length) return;
		events.slice(0, 8).forEach((ev, idx) => {
			const card = document.createElement('article');
			card.className = 'event' + (idx === 0 ? ' latest' : '');
			const head = document.createElement('div');
			head.className = 'ev-head';
			head.innerHTML = '<time></time><strong></strong>';
			head.querySelector('time').textContent = fmtTime(ev.t);
			head.querySelector('strong').textContent = ev.text;
			card.appendChild(head);
			if (ev.note) {
				const p = document.createElement('p');
				p.className = 'ev-note';
				p.textContent = ev.note;
				card.appendChild(p);
			}
			if (ev.table) card.appendChild(titrationTable(ev.table));
			const after = ev.done ? ev.final : snapshot(out);
			const elapsed = (ev.done ? ev.final.t : out.t) - ev.t;
			const changes = analyze(ev.snap, after).filter(c => !(c.n.cat === 'vent' && idx > 0));
			const meta = document.createElement('p');
			meta.className = 'ev-meta';
			meta.textContent = elapsed < 1 ? 'in attesa degli effetti…' :
				(ev.done ? 'effetti fino all’intervento successivo (' : 'effetti dopo ') + fmtTime(elapsed) + (ev.done ? ')' : ' min') +
				(changes.length ? '' : ': nessuna variazione rilevante');
			card.appendChild(meta);
			if (changes.length && (idx < 3)) {
				const ul = document.createElement('ul');
				ul.className = 'ev-list';
				changes.slice(0, idx === 0 ? 16 : 6).forEach(c => {
					const li = document.createElement('li');
					const up = c.d > 0;
					li.innerHTML = '<span class="arrow ' + (up ? 'up' : 'down') + '">' + (up ? '▲' : '▼') + '</span>' +
						'<div class="ev-body"><button class="linklike"></button> <span class="ev-vals"></span><span class="why"></span></div>';
					const btn = li.querySelector('button');
					btn.textContent = c.n.labelFn ? c.n.labelFn(after) : c.n.label;
					btn.addEventListener('click', () => graph.select(c.n.id));
					const unit = c.n.unitFn ? c.n.unitFn(after) : c.n.unit;
					li.querySelector('.ev-vals').textContent = fmtNum(c.a, c.n.dec) + ' → ' + fmtNum(c.b, c.n.dec) + (unit ? ' ' + unit : '');
					if (c.causes.length) li.querySelector('.why').textContent = 'per ' + c.causes.slice(0, 3).map(x => (x.d > 0 ? '↑ ' : '↓ ') + x.n.label.toLowerCase()).join(', ');
					ul.appendChild(li);
				});
				card.appendChild(ul);
			}
			box.appendChild(card);
		});
	}

	function titrationTable(tab) {
		const wrap = document.createElement('div');
		wrap.className = 'table-wrap';
		const t = document.createElement('table');
		t.innerHTML = '<thead><tr><th>PEEP</th><th>Crs</th><th>Pplat</th><th>ΔP</th><th>SpO₂</th><th>GC</th><th>PAM</th></tr></thead><tbody></tbody>';
		const tb = t.querySelector('tbody');
		tab.rows.forEach(r => {
			const tr = document.createElement('tr');
			if (r.peep === tab.best) tr.className = 'best';
			[r.peep, r.crs.toFixed(0), r.pplat.toFixed(0), r.dp.toFixed(0), r.spo2.toFixed(0), r.co.toFixed(1), r.map.toFixed(0)].forEach(v => {
				const td = document.createElement('td'); td.textContent = v; tr.appendChild(td);
			});
			tb.appendChild(tr);
		});
		wrap.appendChild(t);
		return wrap;
	}

	/* ------------------------------------------------------------ inspector */

	let inspectorRefs = null;

	function showNode(id) {
		const empty = $('node-empty'), box = $('node-detail');
		if (!id) { empty.hidden = false; box.hidden = true; inspectorRefs = null; return; }
		const n = C.byId[id], cat = C.CATEGORIES[n.cat];
		empty.hidden = true; box.hidden = false;
		box.innerHTML =
			'<div class="nd-cat"><i></i><span></span><button class="btn btn-small nd-close" aria-label="Chiudi">×</button></div>' +
			'<h2 class="nd-title"></h2>' +
			'<div class="nd-actions"><button type="button" class="btn btn-small nd-live"><span class="nd-live-fx" aria-hidden="true">ƒ(x)</span> Equazioni dal vivo</button>' +
						'<button type="button" class="btn btn-small nd-power" aria-pressed="false"></button></div>' +
			'<div class="nd-value"><output class="nd-big"></output><span class="nd-unit"></span><span class="pill"></span></div>' +
			'<p class="nd-sub"></p>' +
			'<canvas class="nd-spark" aria-label="Andamento negli ultimi 10 minuti"></canvas>' +
			'<h3>Cosa rappresenta</h3><p class="nd-desc"></p>' +
			'<h3>In breve</h3><p class="formula-simple"></p>' +
						'<h3>Come si calcola</h3><p class="formula"></p>' +
			'<h3>Dipende da</h3><div class="rel" data-dir="in"></div>' +
			'<h3>Influenza</h3><div class="rel" data-dir="out"></div>';
		box.querySelector('.nd-cat i').style.background = cat.color;
		box.querySelector('.nd-cat span').textContent = cat.label;
		box.querySelector('.nd-close').addEventListener('click', () => graph.select(null));
		const live = box.querySelector('.nd-live');
		live.hidden = !eqView.has(id);
		live.addEventListener('click', () => eqView.open(id, out));
		if (!eqView.el.hidden) eqView.open(id, out);
		box.querySelector('.nd-title').textContent = n.labelFn ? n.labelFn(out) : n.label;
		box.querySelector('.nd-desc').textContent = n.desc;
		box.querySelector('.formula').textContent = n.formula;
				box.querySelector('.formula-simple').textContent = n.simple;
				const pw = box.querySelector('.nd-power');
				pw.hidden = !FREEZABLE.has(id);
				pw.addEventListener('click', () => toggleNode(id));
		const rel = (dir, list) => {
			const c = box.querySelector('.rel[data-dir="' + dir + '"]');
			if (!list.length) { c.innerHTML = '<p class="hint">Parametro impostato dall’operatore o dalla condizione del paziente.</p>'; return []; }
			return list.map(([other, sign]) => {
				const b = document.createElement('button');
				b.className = 'rel-chip';
				b.innerHTML = '<span class="sgn"></span><span class="rl"></span><span class="rv"></span>';
				b.querySelector('.sgn').textContent = sign === '-' ? '−' : sign;
				b.querySelector('.sgn').className = 'sgn ' + (sign === '+' ? 'pos' : sign === '-' ? 'neg' : 'amb');
				b.querySelector('.rl').textContent = C.byId[other].label;
				b.addEventListener('click', () => graph.select(other));
				c.appendChild(b);
				return { id: other, el: b.querySelector('.rv') };
			});
		};
		inspectorRefs = { id, box, chips: rel('in', n.in).concat(rel('out', n.out)) };
		updateInspector();
	}

	function updateInspector() {
		if (!inspectorRefs) return;
		const n = C.byId[inspectorRefs.id], box = inspectorRefs.box;
		const v = C.nodeValue(n, out);
		box.querySelector('.nd-big').textContent = fmtNum(v, n.dec);
		box.querySelector('.nd-unit').textContent = n.unitFn ? n.unitFn(out) : n.unit;
		box.querySelector('.nd-sub').textContent = n.subFn ? n.subFn(out) : '';
		const st = C.nodeStatus(n, out);
		const pill = box.querySelector('.pill');
		pill.className = 'pill ' + st;
		pill.textContent = n.range ? (st === 'ok' ? 'nel range' : st === 'warn' ? 'attenzione' : 'critico') : '';
		pill.hidden = !n.range;
		inspectorRefs.chips.forEach(c => {
			const o = C.byId[c.id];
			c.el.textContent = fmtNum(C.nodeValue(o, out), o.dec);
		});
		const rows = history.filter(r => r.t >= out.t - 600);
				sparkline(box.querySelector('.nd-spark'), rows, n.id, cssVar('--c-' + n.cat) || '#0b6e82');
				const off = inspectorRefs.id in model.frozen;
				const pw = box.querySelector('.nd-power');
				pw.textContent = off ? '⏻ Riattiva nodo' : '⏻ Disattiva nodo';
				pw.classList.toggle('is-off', off);
				pw.setAttribute('aria-pressed', off);
				box.classList.toggle('node-off', off);
	}

	function recordHistory() {
		const row = { t: out.t };
		C.NODES.forEach(n => { row[n.id] = C.nodeValue(n, out); });
		history.push(row);
		if (history.length > 3600) history.shift();
	}

	/* ------------------------------------------------------------ monitor numerics */

	let numericEls = [];
	function buildNumerics() {
		const box = $('numerics');
		box.innerHTML = '';
		numericEls = NUMERICS.map(nm => {
					const d = document.createElement('div');
					d.className = 'num' + (nm.vital ? ' vital' : ' ventn');
			d.style.setProperty('--num-color', nm.color);
			d.innerHTML = '<span class="num-label"></span><span class="num-val"></span><span class="num-unit"></span>';
			d.querySelector('.num-label').textContent = nm.label;
			d.querySelector('.num-unit').textContent = nm.unit;
			box.appendChild(d);
			return { nm, val: d.querySelector('.num-val'), unit: d.querySelector('.num-unit') };
		});
	}

	/* ------------------------------------------------------------ loop */

	let lastUiT = 0, lastGraphSimT = 0;

	function updateUI() {
		$('sim-time').textContent = fmtTime(out.t);
				syncNodeSwitches();
				$('vent-mode-label').textContent = modeLabel(out);
				graph.update(out, reference, out.t - lastGraphSimT);
		lastGraphSimT = out.t;
		numericEls.forEach(e => {
			e.val.textContent = e.nm.val(out);
			e.unit.textContent = (e.nm.sub ? e.nm.sub(out) + ' ' : '') + e.nm.unit;
		});
		trends.draw(out);
		updateInspector();
		eqView.update(out);
		if (maneuver) {
			const st = maneuver.steps[maneuver.i];
			$('ms-step').textContent = st ? st.label + ' · ' + Math.max(0, st.dur - maneuver.tStep).toFixed(0) + ' s' : '';
			$('ms-bar').style.width = (100 * maneuver.elapsed / maneuver.total).toFixed(1) + '%';
		}
		const latest = events[0];
		if (latest && !latest.done) {
			if (out.t - latest.t > 240) { latest.done = true; latest.final = snapshot(out); }
			renderEvents();
		}
	}

	let lastFrame = null, acc = 0, recAcc = 0, lastPvT = 0;
	let pvPanel = null, pvCanvas = null;
	function frame(now) {
		if (lastFrame === null) lastFrame = now;
		const realDt = Math.min(0.1, (now - lastFrame) / 1000);
		lastFrame = now;
		if (running) {
			const h = speed <= 5 ? 0.1 : 0.25;
			acc += realDt * speed;
			let guard = 0;
			while (acc >= h && guard++ < 400) {
				out = model.step(h);
				tickManeuver(h);
				acc -= h;
				recAcc += h;
				if (recAcc >= 1) { recAcc -= 1; recordHistory(); trends.record(out); }
			}
			if (guard >= 400) acc = 0;
		}
		monitor.push(out, now);
		monitor.draw(out);
		if (!pvPanel.hidden) {
			drawPV(pvCanvas, model.pv);
			if (model.pv && model.pv.running && now - lastPvT > 250) { lastPvT = now; renderPV(); }
		}
		if (now - lastUiT > 250) { lastUiT = now; updateUI(); }
		requestAnimationFrame(frame);
	}

	/* ------------------------------------------------------------ wiring */

	function wire() {
		const presetSel = $('preset');
		PRESETS.forEach(p => { const o = document.createElement('option'); o.value = p.id; o.textContent = p.label; presetSel.appendChild(o); });
		presetSel.addEventListener('change', () => loadPreset(presetSel.value));

		document.querySelectorAll('#vent-mode button').forEach(b => b.addEventListener('click', () => {
			if (b.dataset.mode !== model.ventilator.mode) commitVent({ mode: b.dataset.mode });
		}));
		const chips = $('peep-chips');
		[0, 5, 8, 10, 12, 15, 18, 20].forEach(p => {
			const b = document.createElement('button');
			b.className = 'chip';
			b.dataset.peep = p;
			b.textContent = p;
			b.addEventListener('click', () => { commitVent({ PositiveEndExpiratoryPressure: p }); syncVentUI(); });
			chips.appendChild(b);
		});

		$('m-si').addEventListener('click', () => sustainedInflation());
		$('m-staircase').addEventListener('click', () => {
			staircase();
			if (speed < 20) setSpeed(20);
		});
		$('m-fluid').addEventListener('click', () => fluidBolus(500));
		$('m-bleed').addEventListener('click', () => hemorrhage(500));
		$('ms-stop').addEventListener('click', () => stopManeuver(false));

		$('btn-play').addEventListener('click', () => setRunning(!running));
		document.querySelectorAll('#speed button').forEach(b => b.addEventListener('click', () => setSpeed(+b.dataset.speed)));
		$('btn-reset').addEventListener('click', () => {
			stopManeuver(true);
			model.reset();
			restart('Paziente riavviato allo stato stazionario');
		});
		document.querySelectorAll('#trend-span button').forEach(b => b.addEventListener('click', () => {
			trends.span = +b.dataset.span;
			document.querySelectorAll('#trend-span button').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', x === b); });
			trends.draw(out);
		}));

		$('btn-ref').addEventListener('click', () => { reference = snapshot(out); graph.update(out, reference, 0); });
		$('z-in').addEventListener('click', () => graph.zoom(1 / 1.2));
		$('z-out').addEventListener('click', () => graph.zoom(1.2));
		$('z-fit').addEventListener('click', () => graph.fit());
		$('z-reset').addEventListener('click', () => graph.resetLayout());
		$('import-file').addEventListener('change', ev => { if (ev.target.files[0]) importFile(ev.target.files[0]); ev.target.value = ''; });
				wireView();
			}

			/* ------------------------------------------------------------ view, settings, switched-off nodes */

			const PREFS_KEY = 'breathe-nodesim-prefs';
			let prefs = { view: 'full', formulas: false, switches: false };
			try { prefs = Object.assign(prefs, JSON.parse(localStorage.getItem(PREFS_KEY) || '{}')); } catch (e) { /* storage unavailable */ }
			const savePrefs = () => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) { /* storage unavailable */ } };

			function setView(v) {
				prefs.view = v === 'console' || v === 'network' ? v : 'full';
				savePrefs();
				document.querySelector('.app').classList.toggle('console-mode', prefs.view === 'console');
				document.querySelector('.app').classList.toggle('network-mode', prefs.view === 'network');
				graph.setOrdered(prefs.view === 'network');
				document.querySelectorAll('#view-mode button').forEach(b => {
					const on = b.dataset.view === prefs.view;
					b.classList.toggle('on', on);
					b.setAttribute('aria-checked', on);
				});
				if (prefs.view !== 'console') requestAnimationFrame(() => graph.fit());
			}

			function wireView() {
				document.querySelectorAll('#view-mode button').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));
				const menu = $('settings-menu'), btn = $('btn-settings');
				const close = () => { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
				btn.addEventListener('click', ev => {
					ev.stopPropagation();
					menu.hidden = !menu.hidden;
					btn.setAttribute('aria-expanded', String(!menu.hidden));
				});
				document.addEventListener('click', ev => { if (!menu.hidden && !menu.contains(ev.target)) close(); });
				document.addEventListener('keydown', ev => { if (ev.key === 'Escape') close(); });
				$('set-formulas').checked = prefs.formulas;
				$('set-switches').checked = prefs.switches;
				$('set-formulas').addEventListener('change', ev => { prefs.formulas = ev.target.checked; savePrefs(); graph.setFormulas(prefs.formulas); });
				$('set-switches').addEventListener('change', ev => { prefs.switches = ev.target.checked; savePrefs(); $('graph').classList.toggle('show-switches', prefs.switches); });
				$('btn-all-on').addEventListener('click', () => {
					const ids = Object.keys(model.frozen);
					ids.forEach(id => model.setNodeEnabled(id, true));
					if (ids.length) logEvent('Riattivati tutti i nodi (' + ids.map(id => C.byId[id].label).join(', ') + ')', '', true);
					syncNodeSwitches();
				});
				//nodes that cannot be switched off (settings and patient characteristics) have no switch
				C.NODES.forEach(n => { if (!FREEZABLE.has(n.id)) graph.nodeEls[n.id].pwr.style.display = 'none'; });
				graph.onToggle = toggleNode;
				if (prefs.formulas) graph.setFormulas(true);
				$('graph').classList.toggle('show-switches', prefs.switches);
				setView(prefs.view);
			}

			function toggleNode(id) {
				if (!FREEZABLE.has(id)) return;
				const n = C.byId[id];
				const wasOff = id in model.frozen;
				model.setNodeEnabled(id, wasOff);
				const v = C.nodeValue(n, out);
				logEvent(wasOff ? 'Nodo riattivato: ' + n.label
					: 'Nodo disattivato: ' + n.label + ' fisso a ' + fmtNum(v, n.dec) + ' ' + (n.unitFn ? n.unitFn(out) : n.unit), '', true);
				syncNodeSwitches();
				updateInspector();
				eqView.update(out, true);
			}

			function syncNodeSwitches() {
				const ids = Object.keys(model.frozen);
				graph.setOff(ids);
				$('btn-all-on').disabled = !ids.length;
				$('btn-all-on').textContent = ids.length ? 'Riattiva tutti i nodi (' + ids.length + ')' : 'Riattiva tutti i nodi';
			}

			/* ------------------------------------------------------------ ventilator console */

			function modeLabel(o) {
				if (o.mode === 'SI') return o.override && o.override.type === 'PV' ? 'CURVA P-V · ' + o.pplat.toFixed(0) + ' cmH₂O' : 'RECLUTAMENTO · CPAP ' + o.pplat.toFixed(0) + ' cmH₂O';
				const v = model.ventilator;
				if (o.mode === 'CPAP') return 'CPAP / ASB';
				return (o.mode === 'VC' ? 'VC' : 'PC') + (v.AssistedMode === 0 ? '-AC' : '-CMV');
			}

			function holdLabel(type) { return type === 'insp' ? 'Pausa inspiratoria' : 'Pausa espiratoria'; }

			function renderHoldResults() {
				const box = $('hold-results');
				const ri = holdRes('insp'), re = holdRes('exp');
				const row = (l, v, u) => '<div class="hr-row"><span>' + l + '</span><b>' + v + '</b><i>' + u + '</i></div>';
				let html = '<h3>Manovre di pausa</h3>';
				if (!ri && !re) html += '<p class="hint">Premi <b>Pausa insp.</b> o <b>Pausa esp.</b>: i valori misurati compaiono qui.</p>';
				if (ri) html += row('Pplat', ri.pplat.toFixed(1), 'cmH₂O') + row('ΔP', ri.dp.toFixed(1), 'cmH₂O') +
					row('Cstat', ri.cstat ? ri.cstat.toFixed(0) : dash, 'mL/cmH₂O') + row('R', ri.raw ? ri.raw.toFixed(1) : dash, 'cmH₂O/L/s');
				if (re) html += row('PEEP tot', re.peepTot.toFixed(1), 'cmH₂O') + row('PEEPi', re.peepi.toFixed(1), 'cmH₂O') + row('V intrappolato', re.vtrap.toFixed(0), 'mL');
				box.innerHTML = html;
			}

			function wireConsole() {
				const status = $('hold-status');
				monitor.onHoldStart = type => {
					status.textContent = holdLabel(type) + ' in corso: valvole chiuse';
					status.className = 'vent-status busy';
				};
				monitor.onHoldEnd = (type, r) => {
					const text = type === 'insp'
						? holdLabel(type) + ': Pplat ' + r.pplat.toFixed(1) + ', ΔP ' + r.dp.toFixed(1) + ' cmH₂O' + (r.cstat ? ', Cstat ' + r.cstat.toFixed(0) + ' mL/cmH₂O' : '') + (r.raw ? ', R ' + r.raw.toFixed(1) + ' cmH₂O/L/s' : '')
						: holdLabel(type) + ': PEEP totale ' + r.peepTot.toFixed(1) + ', PEEPi ' + r.peepi.toFixed(1) + ' cmH₂O, volume intrappolato ' + r.vtrap.toFixed(0) + ' mL';
					status.textContent = text;
					status.className = 'vent-status done';
					document.querySelectorAll('.vkey').forEach(b => b.classList.remove('armed'));
					renderHoldResults();
					logEvent(text, type === 'insp' && !r.peepRefMeasured && out.autoPeep > 0.5 ? 'ΔP e Cstat sono calcolati con la PEEP impostata: esegui anche la pausa espiratoria per usare la PEEP totale.' : '', true);
				};
				const bindHold = (id, type) => {
					const b = $(id);
					let pressed = false;
					b.addEventListener('pointerdown', ev => {
						if (ev.button !== 0) return;
						pressed = true;
						startHold(type, 15);
					});
					const up = () => { if (pressed) { pressed = false; monitor.releaseHold(type); } };
					b.addEventListener('pointerup', up);
					b.addEventListener('pointerleave', up);
					b.addEventListener('click', ev => { if (ev.detail === 0) startHold(type); }); // keyboard
				};
				bindHold('hold-insp', 'insp');
				bindHold('hold-exp', 'exp');
				$('pv-key').addEventListener('click', () => openPV($('pv-panel').hidden));
				$('pv-close').addEventListener('click', () => openPV(false));
				$('pv-start').addEventListener('click', () => {
					if (model.pv && model.pv.running) stopManeuver();
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

			function startHold(type, dur) {
				if (!monitor.requestHold(type, dur)) {
					$('hold-status').textContent = 'Nessun respiro da mettere in pausa (apnea o insufflazione sostenuta)';
					$('hold-status').className = 'vent-status';
					return false;
				}
				$(type === 'insp' ? 'hold-insp' : 'hold-exp').classList.add('armed');
				$('hold-status').textContent = holdLabel(type) + ': in attesa della fine ' + (type === 'insp' ? 'dell’inspirazione' : 'dell’espirazione') + '…';
				$('hold-status').className = 'vent-status busy';
				return true;
			}

			//The same maneuver, computed at once on a copy of the current breath (for the assistant)
			function measureHold(type) {
				const p = new BreathPlayer();
				let res = null;
				p.onHoldEnd = (t, r) => { res = r; };
				p.advance(0.001, out);
				p.requestHold(type, type === 'insp' ? 2 : 3);
				for (let t = 0; t < 40 && !res; t += 0.02) p.advance(0.02, out);
				return res;
			}

	function setSpeed(s) {
		speed = s;
		document.querySelectorAll('#speed button').forEach(b => {
			const on = +b.dataset.speed === s;
			b.classList.toggle('on', on);
			b.setAttribute('aria-checked', on);
		});
	}

	function setRunning(on) {
		running = !!on;
		$('btn-play').innerHTML = running ? '&#10074;&#10074;' : '&#9654;';
		$('btn-play').setAttribute('aria-label', running ? 'Pausa' : 'Riprendi');
	}

	function fluidBolus(mL) {
		mL = Math.round(Math.min(3000, Math.max(50, +mL || 500)));
		const minutes = Math.max(1, Math.round(mL / 100));
		model.fluidBolus(mL, minutes * 60);
		logEvent('Bolo di fluidi ' + mL + ' mL in ' + minutes + ' min', 'Aumenta il volume stressato e quindi la pressione media di riempimento: se il paziente è sulla parte ripida della curva di Starling (PPV alta) la gittata sale.');
		return { mL, minutes };
	}

	function hemorrhage(mL) {
		mL = Math.round(Math.min(3000, Math.max(50, +mL || 500)));
		model.hemorrhage(mL);
		logEvent('Emorragia acuta ' + mL + ' mL');
		return { mL };
	}

	/* ------------------------------------------------------------ public API (used by the assistant) */

	const KEY_VALUES = ['map', 'sbp', 'dbp', 'hr', 'co', 'sv', 'rap', 'pmsf', 'mpap', 'ppv', 'spo2', 'pao2', 'paco2', 'etco2', 'pf', 'ph',
		'lactate', 'do2', 'svo2', 'peepTot', 'autoPeep', 'pplat', 'ppeak', 'dp', 'crs', 'aeration', 'overdist', 'shunt', 'vdvt',
		'mpaw', 'pplMean', 'vt', 'rr', 'mp', 'strain'];
	const EXTREMES = { map: 'min', co: 'min', spo2: 'min', hr: 'max', paco2: 'max', pplat: 'max', rap: 'max' };
	const rnd = v => !isFinite(v) ? null : Math.abs(v) >= 100 ? Math.round(v) : Number(v.toFixed(2));

	function keyValues(o) {
		const r = {};
		KEY_VALUES.forEach(k => { r[k] = rnd(o[k]); });
		return r;
	}

	function describeState() {
		const P = model.patient;
		const actions = {};
		for (const k in model.actions) if (model.actions[k] > 0) actions[k] = model.actions[k];
		return {
			simTime: fmtTime(out.t),
			scenario: (PRESETS.find(p => p.id === presetId) || {}).label,
			ventilator: clone(model.ventilator),
			patient: { Sex: P.Sex, Age: P.Age, Weight: P.Weight, Height: P.Height, PBW: rnd(out.pbw), Volemia: P.Volemia, Sedation: P.Sedation, IntraAbdominalPressure: P.IntraAbdominalPressure },
			conditions: clone(model.conditions),
			actions,
			maneuver: maneuver ? { name: maneuver.name, step: (maneuver.steps[maneuver.i] || {}).label, secondsLeft: Math.round(maneuver.total - maneuver.elapsed) } : null,
			switchedOffNodes: Object.keys(model.frozen),
			lastPVCurve: pvState(),
			values: keyValues(out)
		};
	}

	function pvState() {
		const pv = model.pv;
		if (!pv) return null;
		if (pv.running) return { running: true, pressure: model.override ? rnd(model.override.pressure) : null };
		const r = pv.result;
		if (!r) return { aborted: true };
		return { from: r.from, to: r.to, LIP: r.lip, UIP: r.uip, deflationPMC: r.pmc, linearCompliance: rnd(r.cLin), hysteresis_mL: rnd(r.hyst), volumeAtTop_mL: rnd(r.vMax), minutesAgo: rnd((model.t - pv.tStart) / 60) };
	}

	function effects(before, after, max) {
		return analyze(before, after).filter(c => c.n.cat !== 'vent').slice(0, max || 16).map(c => ({
			node: c.n.label,
			before: Number(c.a.toFixed(c.n.dec)), after: Number(c.b.toFixed(c.n.dec)),
			unit: c.n.unitFn ? c.n.unitFn(after) : c.n.unit,
			causes: c.causes.map(x => x.n.label)
		}));
	}

	//Run the model as fast as possible for the given simulated time (maneuvers keep running)
	function advance(seconds) {
		const total = Math.min(1800, Math.max(1, +seconds || 60));
		const before = snapshot(out);
		const ext = {};
		for (const k in EXTREMES) ext[k] = out[k];
		const h = 0.25;
		for (let i = 0, n = Math.round(total / h); i < n; i++) {
			out = model.step(h);
			tickManeuver(h);
			for (const k in EXTREMES) ext[k] = EXTREMES[k] === 'min' ? Math.min(ext[k], out[k]) : Math.max(ext[k], out[k]);
			recAcc += h;
			if (recAcc >= 1) { recAcc -= 1; recordHistory(); trends.record(out); }
		}
		updateUI();
		renderEvents();
		const extremes = {};
		for (const k in EXTREMES) extremes[(EXTREMES[k] === 'min' ? 'min_' : 'max_') + k] = rnd(ext[k]);
		return { advancedSeconds: total, simTime: fmtTime(out.t), changes: effects(before, snapshot(out)), extremesDuringInterval: extremes,
			maneuverRunning: maneuver ? maneuver.name : null, values: keyValues(out) };
	}

	function clampField(spec, v) {
		v = Number(v);
		if (!isFinite(v)) return null;
		return Math.min(spec.max, Math.max(spec.min, Number(v.toFixed(spec.dec))));
	}

	function setVentilatorApi(params) {
		const clean = {};
		if (params.mode !== undefined) {
			const m = String(params.mode).toUpperCase();
			if (m === 'VC' || m === 'PC' || m === 'CPAP') clean.mode = m;
		}
		if (params.AssistedMode !== undefined) clean.AssistedMode = String(params.AssistedMode).toUpperCase() === 'CMV' || +params.AssistedMode === 1 ? 1 : 0;
		for (const k in VENT_FIELDS) {
			if (params[k] === undefined || params[k] === null) continue;
			let v = +params[k];
			if (k === 'FractionInspiredOxygen' && v > 1) v = v / 100;
			const c = clampField(VENT_FIELDS[k], v);
			if (c !== null) clean[k] = c;
		}
		if (!Object.keys(clean).length) throw new Error('Nessun parametro del ventilatore valido');
		//During a sustained inflation the new settings apply when it ends; the PEEP titration drives the ventilator itself
		if (maneuver && maneuver.restore) throw new Error('È in corso la titolazione della PEEP: aspetta che finisca (advance) prima di cambiare il ventilatore');
		commitVent(clean);
		syncVentUI();
		return { applied: clean, ventilator: clone(model.ventilator) };
	}

	function findCondition(name) {
		const n = String(name || '').toLowerCase();
		return CONDITIONS.find(c => c.name.toLowerCase() === n || c.label.toLowerCase() === n);
	}

	function setConditionApi(name, severity, remove) {
		const c = findCondition(name);
		if (!c) throw new Error('Condizione sconosciuta: ' + name + '. Disponibili: ' + CONDITIONS.map(x => x.name).join(', '));
		if (remove || +severity === 0) {
			model.setCondition(c.name, null);
			logEvent(c.label + ' rimossa');
		} else {
			const cur = {};
			c.params.forEach(p => {
				const v = severity === undefined ? p.def : Math.min(p.max, Math.max(p.min, +severity));
				p.keys.forEach(k => { cur[k] = v; });
			});
			model.setCondition(c.name, cur);
			logEvent(c.label + ': ' + c.params.map(p => p.label.replace(/ \(.*\)/, '').toLowerCase() + ' ' + cur[p.keys[0]] + (p.unit ? ' ' + p.unit : '')).join(', '));
		}
		buildConditionFields();
		return { conditions: clone(model.conditions) };
	}

	function setActionApi(name, severity) {
		const n = String(name || '').toLowerCase();
		const a = ACTIONS.find(x => x.name.toLowerCase() === n || x.label.toLowerCase() === n);
		if (!a) throw new Error('Azione sconosciuta: ' + name + '. Disponibili: ' + ACTIONS.map(x => x.name).join(', '));
		const v = Math.min(1, Math.max(0, +severity || 0));
		model.setAction(a.name, v);
		logEvent(a.label + ' ' + (v > 0 ? 'gravità ' + v.toFixed(2) : 'risolta'));
		buildActionFields();
		return { actions: clone(model.actions) };
	}

	function setPatientApi(params) {
		const clean = {};
		for (const k in PATIENT_FIELDS) {
			if (params[k] === undefined || params[k] === null) continue;
			const c = clampField(PATIENT_FIELDS[k], params[k]);
			if (c !== null) clean[k] = c;
		}
		if (params.Sex !== undefined) clean.Sex = String(params.Sex).toUpperCase().startsWith('F') ? 'F' : 'M';
		if (!Object.keys(clean).length) throw new Error('Nessun parametro del paziente valido');
		const parts = Object.keys(clean).map(k => (PATIENT_FIELDS[k] ? PATIENT_FIELDS[k].label.replace(/ \(.*\)/, '') : 'Sesso') + ' ' + model.patient[k] + ' → ' + clean[k]);
		model.setPatient(clean);
		fieldUpdaters.forEach(u => u());
		logEvent(parts.join(', '));
		return { patient: clone(model.patient) };
	}

	window.NodeSim = {
			state: describeState,
			setNodeEnabled(id, enabled) {
				const n = C.byId[id];
				if (!n) throw new Error('Nodo sconosciuto: ' + id + '. Nodi disattivabili: ' + [...FREEZABLE].join(', '));
				if (!FREEZABLE.has(id)) throw new Error('Il nodo "' + n.label + '" è un\'impostazione o una caratteristica del paziente: non si può disattivare');
				if ((id in model.frozen) === !enabled) return { node: n.label, enabled: !!enabled, note: 'già in questo stato' };
				toggleNode(id);
				return { node: n.label, enabled: !!enabled, frozenValue: enabled ? null : rnd(C.nodeValue(n, out)), switchedOff: Object.keys(model.frozen) };
			},
			switchedOffNodes: () => Object.keys(model.frozen).map(id => ({ id, label: C.byId[id].label })),
			freezableNodes: () => [...FREEZABLE].map(id => ({ id, label: C.byId[id].label })),
			holdManeuver(type) {
				type = type === 'exp' || type === 'expiratory' ? 'exp' : 'insp';
				startHold(type);
				const r = measureHold(type);
				if (!r) throw new Error('Nessun respiro da mettere in pausa (apnea o insufflazione sostenuta)');
				const o = {};
				for (const k in r) if (typeof r[k] === 'number' && k !== 'at') o[k] = rnd(r[k]);
				return Object.assign({ maneuver: holdLabel(type) }, o);
			},
		advance,
		setVentilator: setVentilatorApi,
		recruitment(pressure, seconds) {
			sustainedInflation(pressure, seconds);
			return { pressure: +$('si-p').value, seconds: +$('si-t').value, note: 'Manovra avviata; usa advance per far trascorrere il tempo' };
		},
		pvCurve(from, to, rate) {
			const r = pvCurve({ from: from === undefined ? 0 : from, to: to || 40, rate: rate || 2 });
			return Object.assign(r, { note: 'Curva P-V avviata; usa advance per almeno ' + (r.durationSeconds + 1) + ' s, poi leggi lastPVCurve nello stato' });
		},
		lastPVCurve: pvState,
		titration() {
			staircase();
			return { durationSeconds: maneuver ? Math.round(maneuver.total) : 0, note: 'Reclutamento a scalini + titolazione decrementale avviati' };
		},
		fluids: fluidBolus,
		hemorrhage,
		setCondition: setConditionApi,
		setAction: setActionApi,
		setPatient: setPatientApi,
		loadScenario(id) {
			const p = PRESETS.find(x => x.id === id || x.label.toLowerCase() === String(id).toLowerCase());
			if (!p) throw new Error('Scenario sconosciuto: ' + id);
			loadPreset(p.id);
			return describeState();
		},
		effectsSinceLastEvent() {
			const ev = events[0];
			return ev ? { event: ev.text, secondsAgo: Math.round(out.t - ev.t), changes: effects(ev.snap, snapshot(out)) } : null;
		},
		isRunning: () => running,
		setRunning,
		scenarios: () => PRESETS.map(p => ({ id: p.id, label: p.label })),
		conditions: () => CONDITIONS.map(c => ({ name: c.name, label: c.label })),
		actions: () => ACTIONS.map(a => ({ name: a.name, label: a.label }))
	};

	function init() {
		eqView = new window.BreatheEquations.EquationView();
		eqView.onNavigate = id => graph.select(id);
		graph = new window.NodeGraph($('graph'), C, showNode);
		//Double click on a node: straight to its live equations
		$('graph').addEventListener('dblclick', ev => {
			const g = ev.target.closest('.node');
			if (!g) return;
			graph.select(g.dataset.id);
			eqView.open(g.dataset.id, out);
		});
		monitor = new VentConsole($('monitor'), { abp: true, loop: $('loop') });
		pvPanel = $('pv-panel'); pvCanvas = $('pv-canvas');
				wireConsole();
		trends = new Trends($('trends'), TREND_SERIES);
		buildNumerics();
		wire();
		loadPreset(presetId);
		requestAnimationFrame(frame);
	}

	init();
})();
