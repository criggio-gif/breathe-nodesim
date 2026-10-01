/*
 * Side-by-side tables (Markdown) of the Pulse and NodeSim PEEP ladders.
 * Usage: node compare.js <folder with pulse_<sev>.tsv and nodesim_<sev>.tsv>
 */
'use strict';
const fs = require('fs');
const path = require('path');

const dir = process.argv[2] || path.join(__dirname, 'out');
const read = f => {
	const lines = fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter(l => /^(PEEP|\d)/.test(l));
	const head = lines[0].split('\t');
	return lines.slice(1).map(l => { const r = {}; l.split('\t').forEach((v, i) => { r[head[i]] = +v; }); return r; });
};
const COLS = [
	['CO', 'Gittata (L/min)', 2], ['MAP', 'PAM (mmHg)', 0], ['HR', 'FC (bpm)', 0], ['CVP', 'PVC (mmHg)', 1],
	['Ppl', 'Ppl media (cmH₂O)', 1], ['mPAP', 'PAP media (mmHg)', 0], ['PaO2', 'PaO₂ (mmHg)', 0], ['PaCO2', 'PaCO₂ (mmHg)', 0],
	['Shunt', 'Shunt (%)', 0, 100], ['Cstat', 'Cstat (mL/cmH₂O)', 0], ['Pplat', 'Pplat (cmH₂O)', 0], ['Ppeak', 'Ppicco (cmH₂O)', 0]
];
const f = (v, d, k) => (v * (k || 1)).toFixed(d);
const sevs = fs.readdirSync(dir).map(n => (n.match(/^pulse_(.+)\.tsv$/) || [])[1]).filter(Boolean).sort((a, b) => a - b);

const out = ['# Confronto Pulse – NodeSim: scala di PEEP', '',
	'Protocollo: paziente StandardMale di BREATHE senza respiro spontaneo, VC-CMV VT 450 mL, FR 18, Ti 0,9 s, flusso 50 L/min, FiO₂ 0,6; PEEP 0 → 5 → 10 → 15 → 20. Per Pulse, media dell’ultimo mezzo minuto di ogni livello; per NodeSim, valore a fine livello.',
	'La gravità ARDS non ha lo stesso significato nei due modelli: confronta anche gravità diverse a parità di PaO₂ iniziale.', ''];
sevs.forEach(s => {
	const P = read('pulse_' + s + '.tsv'), N = read('nodesim_' + s + '.tsv');
	out.push('## ' + (+s ? 'ARDS gravità ' + s : 'Polmone sano'), '');
	out.push('| PEEP | ' + COLS.map(c => c[1] + ' P / N').join(' | ') + ' |');
	out.push('|' + ' --- |'.repeat(COLS.length + 1));
	P.forEach((p, i) => {
		const n = N[i] || {};
		out.push('| ' + p.PEEP + ' | ' + COLS.map(([k, , d, mul]) => f(p[k], d, mul) + ' / ' + (n[k] === undefined ? '–' : f(n[k], d, mul))).join(' | ') + ' |');
	});
	const d = (rows, k) => rows[rows.length - 1][k] - rows[0][k];
	const pc = (rows, k) => (rows[rows.length - 1][k] / rows[0][k] - 1) * 100;
	out.push('', 'PEEP 0 → 20: gittata Pulse ' + pc(P, 'CO').toFixed(0) + '%, NodeSim ' + pc(N, 'CO').toFixed(0) + '%; PVC Pulse ' + d(P, 'CVP').toFixed(1) + ', NodeSim ' + d(N, 'CVP').toFixed(1) +
		' mmHg; ΔPpl/ΔPEEP Pulse ' + (d(P, 'Ppl') / 20).toFixed(2) + ', NodeSim ' + (d(N, 'Ppl') / 20).toFixed(2) + '; PaO₂ Pulse ' + d(P, 'PaO2').toFixed(0) + ', NodeSim ' + d(N, 'PaO2').toFixed(0) +
		' mmHg; Cstat Pulse ' + d(P, 'Cstat').toFixed(0) + ', NodeSim ' + d(N, 'Cstat').toFixed(0) + ' mL/cmH₂O.', '');
});
console.log(out.join('\n'));
