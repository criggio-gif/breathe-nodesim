/*
 * Comparison of the model with published data. Each check runs the model on the conditions of a
 * study and requires the result to fall in the range reported there (or around it: the model is
 * explanatory, not a fit of individual patients).
 * Run with: node test/literature.test.js
 */
'use strict';
const assert = require('assert');
const { PhysiologyModel } = require('../js/physiology.js');

const run = (m, s, dt = 1) => { for (let i = 0; i < s / dt; i++) m.step(dt); return Object.assign({}, m.out); };
const ARDS = s => ({ 'ARDS': { LeftLungSeverity: s, RightLungSeverity: s } });
const within = (v, lo, hi, what) => assert(v >= lo && v <= hi, what + ' = ' + v.toFixed(2) + ', atteso ' + lo + '–' + hi);

const checks = [];
function check(name, fn) { checks.push({ name, fn }); }

check('Anaesthetised healthy adult: textbook values', () => {
	const m = new PhysiologyModel();
	m.setVentilator({ FractionInspiredOxygen: 0.4, TidalVolume: 500, RespirationRate: 12 });
	const o = run(m, 600);
	within(o.crs, 45, 70, 'Crs (mL/cmH2O)');
	within(o.pplat, 10, 18, 'Pplat (cmH2O)');
	within(o.paco2, 35, 45, 'PaCO2 (mmHg)');
	within(o.co, 4.5, 6.5, 'GC (L/min)');
	within(o.map, 70, 95, 'PAM (mmHg)');
	within(o.pvr, 0.8, 2.2, 'PVR (WU)');
});

check('Anaesthesia atelectasis (Hedenstierna): the healthy lung loses about 5-10% of aeration at ZEEP and PEEP 8-10 reopens most of it', () => {
	const aer = peep => { const m = new PhysiologyModel(); m.setVentilator({ TidalVolume: 500, PositiveEndExpiratoryPressure: peep }); return run(m, 600).aeration; };
	const zeep = aer(0), peep10 = aer(10);
	within(100 - zeep, 4, 10, 'polmone non aerato in ZEEP (%)');
	assert(peep10 - zeep > 3, 'aerazione ZEEP ' + zeep.toFixed(1) + ' → PEEP 10 ' + peep10.toFixed(1));
});

check('Gattinoni 2006: recruitable lung about 13 ± 11%, non-recruitable about 24% (moderate ARDS)', () => {
	const o = new PhysiologyModel({ conditions: ARDS(0.6) }).out;
	within(o.recruitable, 8, 24, 'polmone reclutabile (%)');
	within(o.consolidated, 12, 30, 'polmone non reclutabile (%)');
});

check('Crotti 2001: opening pressures around 20 cmH2O, closing pressures around 5 cmH2O', () => {
	const o = new PhysiologyModel({ conditions: ARDS(0.6) }).out;
	within(o.pOpen, 18, 27, 'pressione di apertura (cmH2O)');
	within(o.pClose, 3, 9, 'pressione di chiusura (cmH2O)');
});

check('Chest wall share of PEEP transmission: about 0.4-0.5 in the healthy, lower in pulmonary ARDS, higher with a tense abdomen (Gattinoni 1998)', () => {
	const share = (opts) => {
		const m = new PhysiologyModel(opts);
		m.setVentilator({ PositiveEndExpiratoryPressure: 0, TidalVolume: 450 });
		const a = run(m, 600);
		m.setVentilator({ PositiveEndExpiratoryPressure: 15 });
		const b = run(m, 600);
		return (b.pplMean - a.pplMean) / 15;
	};
	const healthy = share(), ards = share({ conditions: ARDS(0.6) }), abdomen = share({ conditions: ARDS(0.6), patient: { IntraAbdominalPressure: 20 } });
	within(healthy, 0.38, 0.55, 'sano ΔPpl/ΔPEEP');
	within(ards, 0.2, 0.38, 'ARDS polmonare ΔPpl/ΔPEEP');
	assert(abdomen > ards + 0.08, 'addome teso ' + abdomen.toFixed(2) + ' vs ARDS ' + ards.toFixed(2));
});

check('Chikhani 2016 and clinical series: PEEP 0 → 20 in ARDS lowers DO2 by about 15-35% while PaO2 rises by tens of mmHg', () => {
	const m = new PhysiologyModel({ conditions: ARDS(0.6) });
	m.setVentilator({ FractionInspiredOxygen: 0.6, TidalVolume: 450, RespirationRate: 18, PositiveEndExpiratoryPressure: 0 });
	const a = run(m, 900);
	m.setVentilator({ PositiveEndExpiratoryPressure: 20 });
	const b = run(m, 900);
	within((b.do2 / a.do2 - 1) * 100, -35, -15, 'variazione DO2 (%)');
	within((b.co / a.co - 1) * 100, -36, -15, 'variazione GC (%)');
	within(b.pao2 - a.pao2, 15, 90, 'aumento PaO2 (mmHg)');
});

check('Maas 2009: mean systemic filling pressure in ventilated patients about 19 ± 5 mmHg, venous return gradient of a few mmHg', () => {
	const o = new PhysiologyModel().out;
	within(o.pmsf, 14, 24, 'Pmsf (mmHg)');
	within(o.rap, 5, 11, 'PVC (mmHg)');
	within(o.vrGradient, 5, 13, 'gradiente di ritorno venoso (mmHg)');
});

check('Benumof 1997: apnea after preoxygenation, time to SpO2 90% about 8.7 min (healthy), 3 min (127 kg), about 5 min (ill)', () => {
	const apnea = (patient, conditions) => {
		const m = new PhysiologyModel({ patient, conditions });
		m.setVentilator({ FractionInspiredOxygen: 1, PositiveEndExpiratoryPressure: 5 });
		run(m, 900);
		m.setVentilator({ mode: 'CPAP', DeltaPressureSupport: 0 });
		m.setPatient({ Sedation: 1 });
		const p0 = m.out.paco2;
		let t = 0;
		while (t < 1500 && m.out.spo2 > 90) { m.step(1); t++; }
		return { min: t / 60, co2Rate: (m.out.paco2 - p0) / (t / 60) };
	};
	const healthy = apnea({}), obese = apnea({ Weight: 127 }), ill = apnea({}, ARDS(0.6));
	within(healthy.min, 7, 10.5, 'sano (min)');
	within(obese.min, 2, 4.2, 'obeso 127 kg (min)');
	within(ill.min, 3.5, 7, 'malato (min)');
	within(healthy.co2Rate, 2.5, 6, 'aumento PaCO2 in apnea (mmHg/min)');
});

check('Intrinsic PEEP in COPD with short expiration: a few to about 12 cmH2O', () => {
	const m = new PhysiologyModel({ conditions: { 'COPD': { BronchitisSeverity: 0.8, LeftLungEmphysemaSeverity: 0.7, RightLungEmphysemaSeverity: 0.7 } } });
	m.setVentilator({ RespirationRate: 26, InspiratoryPeriod: 1.2, TidalVolume: 500 });
	within(run(m, 600).autoPeep, 5, 14, 'PEEPi (cmH2O)');
});

check('Nunn iso-shunt: with FiO2 1.0, PaO2 about 500 at 10% shunt and about 100 at 30% shunt', () => {
	const pao2 = sev => { const m = new PhysiologyModel({ conditions: { 'Pulmonary Shunt': { Severity: sev } } }); m.setVentilator({ FractionInspiredOxygen: 1 }); return run(m, 600); };
	const low = pao2(0.2), mid = pao2(0.8);
	within(low.shunt, 8, 12, 'shunt basso (%)');
	within(low.pao2, 420, 580, 'PaO2 con shunt 10%');
	within(mid.shunt, 28, 34, 'shunt alto (%)');
	within(mid.pao2, 80, 160, 'PaO2 con shunt 30%');
});

check('Pulse pressure variation: below 13% when normovolemic, above it when hypovolemic (VT 8 mL/kg)', () => {
	const ppv = vol => { const m = new PhysiologyModel({ patient: { Volemia: vol } }); m.setVentilator({ TidalVolume: 600 }); return run(m, 600).ppv; };
	within(ppv(1), 5, 13, 'PPV normovolemia (%)');
	within(ppv(0.8), 14, 35, 'PPV ipovolemia 20% (%)');
});

const pvCurve = (opts) => {
	const m = new PhysiologyModel(opts);
	m.setVentilator({ PositiveEndExpiratoryPressure: 5 });
	run(m, 600);
	m.startPVCurve({ from: 0, to: 40, rate: 2 });
	while (m.override) m.step(0.1);
	return m.pv.result;
};

check('Quasi-static P-V curve in ARDS (Ranieri 1994, Roupie 1995): lower inflection point about 10-20, upper about 25-32 cmH2O, hysteresis', () => {
	const r = pvCurve({ conditions: ARDS(0.6) });
	assert(r.lip !== null, 'LIP non trovato');
	within(r.lip, 8, 20, 'LIP (cmH2O)');
	within(r.uip, 24, 32, 'UIP (cmH2O)');
	within(r.cLin, 30, 60, 'compliance lineare (mL/cmH2O)');
	assert(r.hyst > 50, 'isteresi ' + r.hyst.toFixed(0) + ' mL');
});

check('Quasi-static P-V curve in the healthy anaesthetised lung: no lower inflection point, linear to about 25-30 cmH2O (Rahn relaxation curve)', () => {
	const r = pvCurve();
	assert(r.lip === null, 'LIP ' + r.lip);
	assert(r.uip === null || r.uip >= 26, 'UIP ' + r.uip);
	within(r.cLin, 45, 75, 'compliance lineare (mL/cmH2O)');
});

check('Decremental PEEP titration in recruitable ARDS: static compliance is highest at an intermediate PEEP (bell shape)', () => {
	const m = new PhysiologyModel({ conditions: ARDS(0.6) });
	m.setVentilator({ TidalVolume: 450, RespirationRate: 18, PositiveEndExpiratoryPressure: 5 });
	run(m, 600);
	m.startSustainedInflation(40, 40); run(m, 40);
	const crs = {};
	[24, 20, 16, 12, 8, 4].forEach(p => { m.setVentilator({ PositiveEndExpiratoryPressure: p }); crs[p] = run(m, 120).crs; });
	const best = Object.keys(crs).reduce((a, b) => crs[b] > crs[a] ? b : a);
	within(+best, 8, 18, 'PEEP a compliance massima');
	assert(crs[24] < crs[best] * 0.85 && crs[4] < crs[best] * 0.95, 'Crs ' + JSON.stringify(crs));
});

let failed = 0;
for (const c of checks) {
	try { c.fn(); console.log('ok   ' + c.name); }
	catch (e) { failed++; console.log('FAIL ' + c.name + ': ' + e.message); }
}
console.log(failed ? failed + ' check(s) failed' : 'all checks passed');
process.exit(failed ? 1 : 0);
