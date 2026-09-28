/*
 * Checks of the ventilator console: waveforms and hold maneuvers agree with the model.
 * Run with: node test/console.test.js
 */
'use strict';
const assert = require('assert');
const { PhysiologyModel } = require('../js/physiology.js');
const { buildBreath, BreathPlayer } = require('../js/console.js');

const checks = [];
function check(name, fn) { checks.push({ name, fn }); }
function settled(opts, vent) {
	const m = new PhysiologyModel(opts);
	if (vent) m.setVentilator(vent);
	for (let i = 0; i < 300; i++) m.step(1);
	return m.out;
}
function play(o, hold, seconds) {
	const p = new BreathPlayer();
	let res = null;
	p.onHoldEnd = (t, r) => { res = r; };
	p.advance(0.001, o);
	if (hold) p.requestHold(hold, hold === 'insp' ? 2 : 3);
	for (let t = 0; t < seconds; t += 0.01) p.advance(0.01, o);
	return { p, res };
}

check('VC breath: delivered VT, peak and plateau match the model', () => {
	const o = settled();
	const b = buildBreath(o);
	assert(Math.abs(b.vt - o.vt) < 5, 'VT ' + b.vt + ' vs ' + o.vt);
	assert(Math.abs(b.ppeak - o.ppeak) < 1.5, 'Ppeak ' + b.ppeak + ' vs ' + o.ppeak);
	assert(b.insp.f.every(f => f >= 0) && b.exp.f.every(f => f <= 0.01), 'flow sign by phase');
	assert(Math.abs(b.vEndExp - b.V0) < 15, 'volume returns to start: ' + (b.vEndExp - b.V0));
});

check('inspiratory hold measures Pplat, Cstat and resistance of the model', () => {
	const o = settled({ conditions: { 'ARDS': { LeftLungSeverity: 0.6, RightLungSeverity: 0.6 } } }, { PositiveEndExpiratoryPressure: 10 });
	const { res } = play(o, 'insp', 12);
	assert(res, 'no hold result');
	assert(Math.abs(res.pplat - o.pplat) < 1, 'Pplat ' + res.pplat + ' vs ' + o.pplat);
	assert(Math.abs(res.cstat - o.crs) / o.crs < 0.1, 'Cstat ' + res.cstat + ' vs ' + o.crs);
	assert(res.raw > o.raw * 0.8 && res.raw < o.raw * 1.4, 'R ' + res.raw + ' vs ' + o.raw);
});

check('expiratory hold reveals the model auto-PEEP in COPD with short expiration', () => {
	const o = settled({ conditions: { 'COPD': { BronchitisSeverity: 0.8, LeftLungEmphysemaSeverity: 0.7, RightLungEmphysemaSeverity: 0.7 } } },
		{ RespirationRate: 26, InspiratoryPeriod: 1.1, PositiveEndExpiratoryPressure: 5 });
	assert(o.autoPeep > 2, 'model autoPEEP ' + o.autoPeep);
	const { res } = play(o, 'exp', 14);
	assert(res, 'no hold result');
	assert(Math.abs(res.peepi - o.autoPeep) < 1, 'PEEPi ' + res.peepi + ' vs ' + o.autoPeep);
	assert(Math.abs(res.peepTot - o.peepTot) < 1, 'PEEPtot ' + res.peepTot + ' vs ' + o.peepTot);
});

check('expiratory hold without trapping reads the set PEEP', () => {
	const o = settled();
	const { res } = play(o, 'exp', 14);
	assert(res && res.peepi < 0.5, 'PEEPi ' + (res && res.peepi));
});

check('PC and pressure support breaths are pressure limited with decelerating flow', () => {
	['PC', 'CPAP'].forEach(mode => {
		const o = settled({ patient: { Sedation: mode === 'CPAP' ? 0.4 : 1 } }, { mode, InspiratoryPressure: 20, DeltaPressureSupport: 10 });
		const b = buildBreath(o);
		assert(b.insp.p.length > 10, mode + ' no inspiration');
		const top = mode === 'PC' ? 20 : o.x.peepE + 10;
		assert(b.ppeak <= top + 0.01, mode + ' peak ' + b.ppeak);
		const k = b.insp.f.indexOf(Math.max(...b.insp.f));
		assert(b.insp.f[b.insp.f.length - 1] < b.insp.f[k], mode + ' flow not decelerating');
	});
});

let failed = 0;
for (const c of checks) {
	try { c.fn(); console.log('ok   ' + c.name); }
	catch (e) { failed++; console.log('FAIL ' + c.name + ': ' + e.message); }
}
console.log(failed ? failed + ' check(s) failed' : 'all checks passed');
process.exit(failed ? 1 : 0);
