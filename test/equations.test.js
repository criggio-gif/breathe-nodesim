/*
 * Live equations must match the model: every equation shown by the equations view is
 * evaluated with the substituted values and compared with its left-hand side, in
 * several scenarios. Run with: node test/equations.test.js
 */
'use strict';
const path = '../js/';
const { PhysiologyModel } = require(path + 'physiology.js');
require(path + 'nodes.js'); require(path + 'equations.js');
const { EQ } = globalThis.BreatheEquations;
const phi = z => { const t = 1 / (1 + 0.2316419 * Math.abs(z)); const d = 0.3989423 * Math.exp(-z * z / 2);
	const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return z > 0 ? 1 - p : p; };
function toJs(tokens) {
	return tokens.map(t => {
		if (typeof t === 'string') return ({ '·': '*', '−': '-', 'Φ': 'phi', 'e': 'Math.E', 'log₁₀': 'Math.log10', 'max': 'Math.max', 'min': 'Math.min', 'clamp': 'clamp01' })[t] ?? t;
		if (t.f) return '((' + toJs(t.f[0]).replace(/^1 -/, '1-') + ')/(' + toJs(t.f[1]) + '))';
		if (t.sup) return 'Math.pow(' + toJs(t.sup[0]) + ',' + toJs(t.sup[1]) + ')';
		if (t.c !== undefined) return '(' + t.c + ')';
		return '(' + t.v + ')';
	}).join(' ');
}
const clamp01 = v => Math.min(1, Math.max(0, v));
const scen = {
	healthy: {}, ards: { conditions: { ARDS: { LeftLungSeverity: .6, RightLungSeverity: .6 } }, ventilator: { PositiveEndExpiratoryPressure: 14 } },
	copd: { conditions: { COPD: { BronchitisSeverity: .7, LeftLungEmphysemaSeverity: .6, RightLungEmphysemaSeverity: .6 } }, ventilator: { RespirationRate: 24 } },
	pc: { ventilator: { mode: 'PC', InspiratoryPressure: 25 } }, cpap: { ventilator: { mode: 'CPAP' }, patient: { Sedation: 0.3 } },
	lvd_hypo: { patient: { Volemia: 0.85 }, conditions: { 'Chronic Ventricular Systolic Disfunction': { Severity: .8 } } }
};
const skip = /^(S⁻¹|S$|∫|pressione|nessun|→|∝|PAS|  |    )/;
let bad = 0, checked = 0;
for (const [name, opt] of Object.entries(scen)) {
	const m = new PhysiologyModel(opt); for (let i = 0; i < 5; i++) m.step(1);
	const o = m.out;
	for (const [id, f] of Object.entries(EQ)) {
		for (const eq of f(o)) {
			const flat = JSON.stringify(eq.rhs);
			if (eq.rhs.some(t => typeof t === 'string' && skip.test(t)) || /"(S⁻¹|∫|→|∝)"/.test(flat)) continue;
			let js = toJs(eq.rhs).replace(/\( (-?)/g, '($1');
			let r; try { r = eval(js); } catch (e) { console.log('EVAL', name, id, eq.lhs.s, js); bad++; continue; }
			const l = eq.lhs.v; checked++;
			const tol = Math.max(Math.abs(l) * 0.02, Math.pow(10, -eq.lhs.d) * 1.5);
			if (!isFinite(r) || Math.abs(r - l) > tol) { bad++; console.log('MISMATCH', name, id, eq.lhs.s, 'lhs', l.toFixed(4), 'rhs', r.toFixed ? r.toFixed(4) : r); }
		}
	}
}
console.log('checked ' + checked + ' equations, mismatches: ' + bad);
process.exit(bad ? 1 : 0);
