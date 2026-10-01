/*
 * The same PEEP ladder as PeepLadder.java, run on the NodeSim model.
 * Usage: node nodesim_ladder.js ardsSeverity [stabilizeSeconds stepSeconds]
 * Prints a tab-separated table with the same columns as the Pulse driver.
 */
'use strict';
const path = require('path');
const { PhysiologyModel } = require(path.join(__dirname, '..', '..', 'js', 'physiology.js'));

const sev = +process.argv[2] || 0;
const stab = +(process.argv[3] || 600), step = +(process.argv[4] || 600);
const m = new PhysiologyModel({ conditions: sev > 0 ? { 'ARDS': { LeftLungSeverity: sev, RightLungSeverity: sev } } : {} });
m.setVentilator({ mode: 'VC', AssistedMode: 1, TidalVolume: 450, RespirationRate: 18, InspiratoryPeriod: 0.9, Flow: 50,
	FractionInspiredOxygen: 0.6, PositiveEndExpiratoryPressure: 0 });
const run = s => { for (let i = 0; i < s; i++) m.step(1); return m.out; };
run(stab);
console.log('PEEP\tCO\tMAP\tHR\tCVP\tmPAP\tPpl\tPaO2\tPaCO2\tShunt\tSaO2\tPplat\tPpeak\tCstat\tPEEPtot\tVT');
for (const p of [0, 5, 10, 15, 20]) {
	m.setVentilator({ PositiveEndExpiratoryPressure: p });
	const o = run(step);
	console.log([p, o.co, o.map, o.hr, o.rap, o.mpap, o.pplMean, o.pao2, o.paco2, o.shunt / 100, o.sao2 / 100,
		o.pplat, o.ppeak, o.crs, o.peepTot, o.vt].map(v => v.toFixed(3)).join('\t'));
}
