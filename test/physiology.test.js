/*
 * Sanity checks of the NodeSim physiology model.
 * Run with: node breathe.nodesim/test/physiology.test.js
 * Each check encodes a textbook, directional effect of mechanical ventilation.
 */
'use strict';
const assert = require('assert');
const { PhysiologyModel } = require('../js/physiology.js');

const ARDS = { 'ARDS': { LeftLungSeverity: 0.6, RightLungSeverity: 0.6 } };

function run(model, seconds) {
	for (let i = 0; i < seconds; i++) model.step(1);
	return Object.assign({}, model.out);
}

const checks = [];
function check(name, fn) { checks.push({ name, fn }); }

check('healthy baseline is physiological', () => {
	const o = new PhysiologyModel().out;
	assert(o.map > 70 && o.map < 100, 'MAP ' + o.map);
	assert(o.co > 4 && o.co < 7.5, 'CO ' + o.co);
	assert(o.spo2 > 95, 'SpO2 ' + o.spo2);
	assert(o.paco2 > 32 && o.paco2 < 48, 'PaCO2 ' + o.paco2);
	assert(o.crs > 40 && o.crs < 90, 'Crs ' + o.crs);
});

check('ARDS lowers compliance and oxygenation', () => {
	const h = new PhysiologyModel().out;
	const a = new PhysiologyModel({ conditions: ARDS }).out;
	assert(a.crs < h.crs, 'Crs');
	assert(a.pf < h.pf, 'P/F');
	assert(a.shunt > h.shunt, 'shunt');
});

check('raising PEEP lowers cardiac output, more so in hypovolemia', () => {
	const drop = patient => {
		const m = new PhysiologyModel({ patient });
		const before = m.out.co;
		m.setVentilator({ PositiveEndExpiratoryPressure: 18 });
		return (before - run(m, 120).co) / before;
	};
	const normo = drop({ Volemia: 1 }), hypo = drop({ Volemia: 0.85 });
	assert(normo > 0, 'CO should fall with PEEP (' + normo + ')');
	assert(hypo > normo, 'hypovolemic drop ' + hypo + ' <= ' + normo);
});

check('raising PEEP increases CVP and PPV depends on volemia', () => {
	const m = new PhysiologyModel();
	const before = m.out;
	m.setVentilator({ PositiveEndExpiratoryPressure: 15 });
	const after = run(m, 120);
	assert(after.rap > before.rap, 'CVP');
	const hypo = new PhysiologyModel({ patient: { Volemia: 0.8 } }).out;
	assert(hypo.ppv > before.ppv, 'PPV');
});

check('PEEP recruits a recruitable ARDS lung and improves oxygenation', () => {
	const m = new PhysiologyModel({ conditions: ARDS });
	const before = m.out;
	m.setVentilator({ PositiveEndExpiratoryPressure: 14 });
	const after = run(m, 600);
	assert(after.aeration > before.aeration, 'aeration');
	assert(after.pao2 > before.pao2, 'PaO2');
});

check('recruitment maneuver: transient hypotension, then benefit kept only with adequate PEEP', () => {
	const m = new PhysiologyModel({ conditions: ARDS });
	const before = m.out;
	m.startSustainedInflation(40, 40);
	const during = run(m, 30);
	assert(during.map < before.map, 'MAP during RM');
	assert(during.co < before.co, 'CO during RM');
	run(m, 10);
	const low = Object.assign(Object.create(Object.getPrototypeOf(m)), m);
	low.S = Object.assign({}, m.S); low.ventilator = Object.assign({}, m.ventilator);
	low.prev = Object.assign({}, m.prev);
	m.setVentilator({ PositiveEndExpiratoryPressure: 14 });
	const kept = run(m, 300);
	low.setVentilator({ PositiveEndExpiratoryPressure: 5 });
	const lost = run(low, 300);
	assert(kept.aeration > lost.aeration, 'aeration kept ' + kept.aeration + ' lost ' + lost.aeration);
	assert(kept.aeration > before.aeration, 'aeration vs baseline');
});

check('short expiratory time in COPD creates auto-PEEP', () => {
	const m = new PhysiologyModel({ conditions: { 'COPD': { BronchitisSeverity: 0.7, LeftLungEmphysemaSeverity: 0.6, RightLungEmphysemaSeverity: 0.6 } } });
	const slow = m.out.autoPeep;
	m.setVentilator({ RespirationRate: 28 });
	const fast = run(m, 60).autoPeep;
	assert(fast > slow && fast > 2, 'auto-PEEP ' + slow + ' -> ' + fast);
});

check('hypoventilation raises PaCO2', () => {
	const m = new PhysiologyModel();
	const before = m.out.paco2;
	m.setVentilator({ RespirationRate: 8 });
	assert(run(m, 600).paco2 > before + 5);
});

check('PEEP increases cardiac output in severe LV systolic dysfunction less than in a normal heart (or raises it)', () => {
	const rel = conditions => {
		const m = new PhysiologyModel({ conditions });
		const b = m.out.co;
		m.setVentilator({ PositiveEndExpiratoryPressure: 12 });
		return run(m, 120).co / b;
	};
	const normal = rel({});
	const lvd = rel({ 'Chronic Ventricular Systolic Disfunction': { Severity: 0.8 } });
	assert(lvd > normal, 'LVD ' + lvd + ' normal ' + normal);
});

check('West zones: high PEEP raises mean PAP, more in hypovolemia (alveolar pressure becomes the downstream pressure)', () => {
	const rise = patient => {
		const m = new PhysiologyModel({ patient });
		const before = m.out.mpap;
		m.setVentilator({ PositiveEndExpiratoryPressure: 20 });
		const o = run(m, 300);
		return { d: o.mpap - before, zone: o.x.zone12, waterfall: o.x.waterfall };
	};
	const normo = rise({ Volemia: 1 }), hypo = rise({ Volemia: 0.8 });
	assert(normo.d > 0, 'mPAP rise ' + normo.d);
	assert(hypo.d > normo.d, 'hypovolemic rise ' + hypo.d + ' <= ' + normo.d);
	assert(hypo.zone > normo.zone && hypo.waterfall > 0, 'zone 1-2 fraction');
});

check('RV function: lowering volemia at high PEEP does not improve it (RV-PA coupling, not mPAP)', () => {
	const rv = vol => {
		const m = new PhysiologyModel({ patient: { Volemia: vol }, conditions: ARDS });
		m.setVentilator({ PositiveEndExpiratoryPressure: 20 });
		return run(m, 300);
	};
	const normo = rv(1), hypo = rv(0.8);
	assert(hypo.mpap <= normo.mpap + 0.5, 'setup: mPAP should not rise with hypovolemia');
	assert(hypo.rvFunc < normo.rvFunc, 'RV function ' + hypo.rvFunc + ' should be < ' + normo.rvFunc);
	assert(new PhysiologyModel().out.rvFunc > 99, 'healthy RV at rest');
});

check('pericardial effusion lowers cardiac output', () => {
	const a = new PhysiologyModel().out;
	const b = new PhysiologyModel({ conditions: { 'Pericardial Effusion': { AccumulatedVolume: 700 } } }).out;
	assert(b.co < a.co && b.map < a.map);
});
check('alveolar O2 store: steady state matches the alveolar gas equation', () => {
	const o = new PhysiologyModel().out;
	assert(Math.abs(o.pAO2 - o.x.pAO2ss) < 1, 'PAO2 ' + o.pAO2 + ' vs ' + o.x.pAO2ss);
});

check('alveolar O2 store: losing ventilation desaturates, faster with a small ARDS lung', () => {
	const fall = conditions => {
		const m = new PhysiologyModel(conditions ? { conditions } : undefined);
		m.setVentilator({ FractionInspiredOxygen: 0.4, PositiveEndExpiratoryPressure: 8 });
		const before = run(m, 600);
		m.setAction('Ventilator Leak', 1);
		const after = run(m, 180);
		return { before, after, dPAO2: before.pAO2 - after.pAO2 };
	};
	const healthy = fall(null), ards = fall(ARDS);
	assert(ards.after.spo2 < 90, 'ARDS SpO2 after 3 min of leak ' + ards.after.spo2);
	assert(ards.after.spo2 < ards.before.spo2 - 5, 'ARDS SpO2 ' + ards.before.spo2 + ' -> ' + ards.after.spo2);
	assert(ards.dPAO2 > healthy.dPAO2, 'PAO2 fall ARDS ' + ards.dPAO2 + ' vs healthy ' + healthy.dPAO2);
});

check('switched-off node: frozen pleural pressure cuts the PEEP effect on cardiac output', () => {
	const peepCO = freeze => {
		const m = new PhysiologyModel();
		if (freeze) m.setNodeEnabled('ppl', false);
		const a = run(m, 5);
		m.setVentilator({ PositiveEndExpiratoryPressure: 15 });
		const b = run(m, 300);
		return { dCO: a.co - b.co, pplA: a.pplMean, pplB: b.pplMean };
	};
	const free = peepCO(false), frozen = peepCO(true);
	assert(Math.abs(frozen.pplB - frozen.pplA) < 1e-9, 'frozen Ppl moved ' + frozen.pplA + ' -> ' + frozen.pplB);
	assert(frozen.dCO < free.dCO * 0.3, 'CO drop frozen ' + frozen.dCO + ' vs free ' + free.dCO);
});

check('switched-off node: frozen sympathetic tone removes the heart rate response to bleeding, and switching back on restores it', () => {
	const m = new PhysiologyModel();
	const hr0 = run(m, 5).hr;
	assert(m.setNodeEnabled('symp', false));
	m.hemorrhage(1000);
	const blocked = run(m, 300);
	assert(Math.abs(blocked.hr - hr0) < 0.5, 'HR moved with frozen symp: ' + hr0 + ' -> ' + blocked.hr);
	assert(blocked.frozen.indexOf('symp') >= 0);
	m.setNodeEnabled('symp', true);
	const free = run(m, 300);
	assert(free.hr > hr0 + 5, 'HR after switching back on ' + free.hr);
});

check('switched-off nodes: every freezable node can be frozen and the model stays finite', () => {
	const { FREEZABLE } = require('../js/physiology.js');
	FREEZABLE.forEach(id => {
		const m = new PhysiologyModel({ conditions: ARDS });
		m.setNodeEnabled(id, false);
		m.setVentilator({ PositiveEndExpiratoryPressure: 14 });
		const o = run(m, 60);
		['co', 'map', 'pao2', 'paco2', 'spo2', 'ph', 'mpap', 'vt', 'pplat'].forEach(k => assert(isFinite(o[k]), id + ': ' + k + ' = ' + o[k]));
	});
});

check('compliance follows aeration: at the same PEEP, less aerated lung gives a lower static compliance (also with the node switched off)', () => {
	const crs = a => {
		const m = new PhysiologyModel();
		m.setVentilator({ TidalVolume: 500, PositiveEndExpiratoryPressure: 5 });
		run(m, 300);
		m.frozen.recruit = a;
		return run(m, 60).crs;
	};
	const full = crs(1), low = crs(0.7);
	assert(low < full * 0.85, 'Crs con aerazione 70% ' + low.toFixed(1) + ' vs 100% ' + full.toFixed(1));
});

check('P-V curve maneuver: pressure ramps up and down, then ventilation resumes and the inflection points are reported', () => {
	const m = new PhysiologyModel({ conditions: ARDS });
	m.startPVCurve({ from: 0, to: 40, rate: 4 });
	let top = 0;
	while (m.override) { m.step(0.25); top = Math.max(top, m.out.pplat); if (m.override) assert(m.out.pvVol !== null, 'pvVol'); }
	assert(Math.abs(top - 40) < 1.1, 'max pressure ' + top);
	assert(m.pv.result && m.pv.result.insp.length > 30 && m.pv.result.esp.length > 30, 'limbs');
	assert(m.pv.result.uip !== null, 'UIP');
	m.step(1);
	assert(m.out.mode !== 'SI' && m.out.pvVol === null, 'ventilation resumed');
	m.startPVCurve({});
	m.step(1);
	m.stopOverride();
	assert(!m.pv.running && m.pv.result === null, 'aborted curve has no result');
});

let failed = 0;
for (const c of checks) {
	try { c.fn(); console.log('ok   ' + c.name); }
	catch (e) { failed++; console.log('FAIL ' + c.name + ': ' + e.message); }
}
console.log(failed ? failed + ' check(s) failed' : 'all checks passed');
process.exit(failed ? 1 : 0);
