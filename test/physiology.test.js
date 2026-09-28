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

check('pericardial effusion lowers cardiac output', () => {
	const a = new PhysiologyModel().out;
	const b = new PhysiologyModel({ conditions: { 'Pericardial Effusion': { AccumulatedVolume: 700 } } }).out;
	assert(b.co < a.co && b.map < a.map);
});

let failed = 0;
for (const c of checks) {
	try { c.fn(); console.log('ok   ' + c.name); }
	catch (e) { failed++; console.log('FAIL ' + c.name + ': ' + e.message); }
}
console.log(failed ? failed + ' check(s) failed' : 'all checks passed');
process.exit(failed ? 1 : 0);
