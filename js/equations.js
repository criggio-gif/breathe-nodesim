/*
 * BREATHE NodeSim - live equations
 *
 * For every node, the equations the model actually uses (js/physiology.js), written
 * symbolically and with the current values substituted. The view is a floating
 * "blackboard" that updates in real time while the simulation runs.
 *
 * Token grammar of an equation's right-hand side:
 *   'text'                         operator or literal, shown as is
 *   {s, v, d, n?}                  variable: symbol, value, decimals, node id to follow
 *   {c: number, d?}                constant (same in both rows)
 *   {f: [num[], den[]]}            fraction
 *   {sup: [base[], exp[]]}         power
 */
(function (global) {
	'use strict';

	const V = (s, v, d, n) => ({ s, v, d: d === undefined ? 1 : d, n });
	const K = (c, d) => ({ c, d: d === undefined ? ((String(c).split('.')[1] || '').length) : d });
	const F = (num, den) => ({ f: [num, den] });
	const P = (base, exp) => ({ sup: [base, exp] });
	const E = (lhs, rhs, note) => ({ lhs, rhs, note });
	const MM = 0.7355;

	const EQ = {
		/* ------------------------------------------------ ventilator & patient */
		peep: o => [
			E(V('PEEPₑ', o.x.peepE, 1, 'peep'), [V('PEEP', o.peepSet, 0, 'peep'), '·', '(', K(1), '−', K(0.5), '·', V('perdita', o.x.leak, 2), ')'],
				'PEEP esterna effettiva: una perdita del circuito ne disperde una parte.')
		],
		insp: o => o.mode === 'PC' ? [
			E(V('ΔP', o.pinsp - o.x.peepE, 1), [V('Pinsp', o.pinsp, 0, 'insp'), '−', V('PEEPₑ', o.x.peepE, 1, 'peep')], 'In PC la pressione di picco è impostata: il volume dipende da compliance e resistenze.')
		] : o.mode === 'CPAP' ? [
			E(V('P spinta', o.ps + o.x.pmus, 1), [V('ΔPS', o.ps, 0, 'insp'), '+', V('Pmus', o.x.pmus, 1)], 'In CPAP il volume nasce da supporto del ventilatore + sforzo del paziente.')
		] : [
			E(V('VT', o.vt, 0, 'vt'), ['min', '(', V('VTimp', o.vtSet, 0, 'insp'), '·', '(', K(1), '−', K(0.6), '·', V('perdita', o.x.leak, 2), ')', ',', V('Flusso', o.x.flowLs * 1000, 0), '·', V('Ti', o.ti, 2, 'ti'), ')'],
				'In VC il volume è imposto, a meno che flusso × Ti non basti a erogarlo.')
		],
		rr: o => [
			o.mode === 'CPAP'
				? E(V('FR', o.rr, 1, 'rr'), [V('FRspont', o.x.spontRR, 1)], 'In CPAP respira solo il paziente: se è sedato del tutto va in apnea.')
				: o.x.pmus > 0 || o.x.spontRR > 0
					? E(V('FR', o.rr, 1, 'rr'), ['max', '(', V('FRimp', o.rrSet, 0), ',', V('FRspont', o.x.spontRR, 1), ')'], 'In modalità AC il paziente può respirare più veloce della frequenza impostata.')
					: E(V('FR', o.rr, 1, 'rr'), [V('FRimp', o.rrSet, 0)], 'Paziente sedato senza sforzo spontaneo: la frequenza è quella impostata.'),
			E(V('FRspont', o.x.spontRR, 1), [V('FRbase', o.x.rrBase, 0), '·', '(', K(1), '−', V('sedaz', o.sedation, 2), ')', '·', P(['(', F([V('PaCO₂', o.paco2, 0, 'paco2')], [K(40)]), ')'], [K(2)])])
		],
		ti: o => [
			E(V('Te', o.te, 2), [V('Ttot', o.x.ttot, 2), '−', V('Ti', o.ti, 2, 'ti')]),
			E(V('Ttot', o.x.ttot, 2), [F([K(60)], [V('FR', o.rr, 1, 'rr')])])
		],
		fio2: o => [
			E(V('PAO₂ regime', o.x.pAO2ss, 0), [V('FiO₂', o.fio2, 2, 'fio2'), '·', K(713), '−', V('PaCO₂', o.paco2, 0, 'paco2'), '·', '(', V('FiO₂', o.fio2, 2, 'fio2'), '+', F([K(1), '−', V('FiO₂', o.fio2, 2, 'fio2')], [K(0.8)]), ')'],
				'Equazione dei gas alveolari (760 − 47 = 713 mmHg, quoziente respiratorio 0,8): il valore verso cui tende la PAO₂.'),
			E(V('dPAO₂/dt', o.x.dPAO2, 1), [F([V('VA', o.va, 2, 'va'), '·', K(1000), '·', '(', V('PIO₂', o.x.pio2, 0), '−', V('PAO₂', o.pAO2, 0), ')', '−', V('K', o.x.o2k, 0), '·', V('VO₂ capt', o.x.o2uptake, 0)], [V('Vpolm', o.x.vLung, 0, 'eelv')])],
				'Riserva di O₂ nel polmone (mmHg/min). Vpolm = EELV + VT/2; K = 863·(1 − 0,2·FiO₂). In apnea la PAO₂ scende di K·VO₂/Vpolm al minuto: più in fretta se il polmone è piccolo.')
		],
		raw: o => [
			E(V('Raw', o.raw, 1, 'raw'), [K(9), '·', '(', K(1), '+', K(2.5), '·', V('bronchite', o.x.copdB, 2), '+', K(0.8), '·', V('enfisema', o.x.copdE, 2), '+', K(3), '·', V('broncocostr', o.x.bronch, 2), ')', '+', K(30), '·', V('ostruzione', o.x.obstr, 2)])
		],
		iap: o => [
			E(V('IAP', o.iap, 0, 'iap'), [V('impostata', o.iap, 0)], 'Normale in terapia intensiva 5–7 mmHg; ipertensione addominale da 12 mmHg. Sopra 7 mmHg irrigidisce la parete toracica, alza la pressione pleurica e comprime le basi polmonari (ARDS "extrapolmonare").')
		],
		ccw: o => [
			E(V('Ccw', o.ccw, 0, 'ccw'), [F([K(o.x.cal.ccw0)], ['(', K(1), '+', K(0.8), '·', V('obesità', o.x.obes, 2), ')', '·', '(', K(1), '+', K(0.05), '·', V('IAP − 7', o.x.iapX, 1, 'iap'), ')'])],
				'obesità = (BMI − 25)/15, limitata a 0–1,5. La pressione intra-addominale sopra 7 mmHg irrigidisce la parete toracica.')
		],
		lungdz: o => [
			E(V('reclutabile', o.x.recruitable, 2, 'lungdz'), [K(0.03), '+', K(o.x.cal.recrArds), '·', V('ARDS', o.x.ards, 2), '+', K(0.15), '·', V('polmonite', o.x.pneu, 2), '+', K(0.08), '·', V('obesità', o.x.obes, 2), '+', K(0.006, 3), '·', V('IAP − 7', o.x.iapX, 1, 'iap')],
				'Calibrato su Gattinoni 2006: reclutabile in media 13 ± 11% del polmone, non reclutabile circa 24%.'),
			E(V('consolidato', o.x.consolidated, 2), [K(o.x.cal.consArds), '·', V('ARDS', o.x.ards, 2), '+', K(0.35), '·', V('polmonite', o.x.pneu, 2)])
		],
		volemia: o => [
			E(V('Volemia', o.volemia / 100, 2, 'volemia'), [V('impostata', o.x.volemiaSet, 2), '+', F([V('ΔV', o.x.fluid, 0)], [V('VS', o.x.bv, 0)])], 'ΔV: fluidi infusi (60% intravascolare) o sangue perso; VS = 70 mL/kg.')
		],
		contract: o => [
			E(V('Contrattilità', o.contract / 100, 2, 'contract'), [K(1), '−', K(0.5), '·', V('disfunzione VS', o.x.lvd, 2)])
		],

		/* --------------------------------------------------------- mechanics */
		vt: o => o.mode === 'VC' ? EQ.insp(o) : o.mode === 'SI' || o.rr === 0 ? [
			E(V('VT', 0, 0, 'vt'), ['nessun atto (apnea / insufflazione sostenuta)'])
		] : [
			E(V('VT', o.vt, 0, 'vt'), [V('ΔVstat', o.x.vstat, 0), '·', '(', K(1), '−', P(['e'], ['−', F([V('Ti', o.x.teff, 2, 'ti')], [V('τ', o.tau, 2)])]), ')', '·', '(', K(1), '−', K(0.3), '·', V('perdita', o.x.leak, 2), ')'],
				'ΔVstat: volume che il polmone raggiungerebbe a equilibrio con la pressione applicata; τ = Raw·Crs.')
		],
		autopeep: o => [
			E(V('PEEPi', o.autoPeep, 1, 'autopeep'), [F([V('Vintrapp', o.x.vtrap, 0)], [V('Crs', o.crs, 0, 'crs')])]),
			E(V('Vintrapp', o.x.vtrap, 0), [V('VT', o.vt, 0, 'vt'), '·', F([V('x', o.x.expTe, 3)], [K(1), '−', V('x', o.x.expTe, 3)])], 'x = e^(−Te/τ): frazione di volume che resta nel polmone alla fine dell\'espirazione'),
			E(V('τ', o.tau, 2), [V('Raw', o.raw, 0, 'raw'), '·', V('Crs', o.crs, 0, 'crs'), '/', K(1000)])
		],
		peeptot: o => [
			E(V('PEEPtot', o.peepTot, 1, 'peeptot'), [V('PEEPₑ', o.x.peepE, 1, 'peep'), '+', V('PEEPi', o.autoPeep, 1, 'autopeep')])
		],
		recruit: o => [
			E(V('Aerazione', o.x.aerExp, 2, 'recruit'), [K(1), '−', V('consolid', o.x.consolidated, 2, 'lungdz'), '−', V('reclutab', o.x.recruitable, 2, 'lungdz'), '·', '(', K(1), '−', V('aperto', o.x.open, 2), ')']),
			E(V('si apre', o.x.openInsp, 2), ['Φ', '(', F([V('Pplat', o.pplat, 1, 'pplat'), '−', V('Popen', o.x.pOpen, 1)], [K(o.x.cal.sdOpen)]), ')'], 'Frazione di unità reclutabili la cui pressione di apertura è superata a fine inspirazione. Pressioni di apertura e chiusura come in Crotti 2001 (mode circa 20 e 5 cmH₂O, apertura molto dispersa).'),
			E(V('resta aperto', o.x.keep, 2), ['Φ', '(', F([V('PEEPtot', o.peepTot, 1, 'peeptot'), '−', V('Pclose', o.x.pClose, 1)], [K(o.x.cal.sdClose)]), ')'], 'Isteresi: "aperto" tende a min(si apre, resta aperto) in ~5 s e collassa verso "resta aperto" in ~40 s.')
		],
		crs: o => [
			E(V('Crs', o.crs, 1, 'crs'), [F([V('VT', o.vt, 0, 'vt')], [V('Pplat', o.pplat, 1, 'pplat'), '−', V('PEEPtot', o.peepTot, 1, 'peeptot')])], 'Pplat deriva dalla curva P-V esponenziale del polmone aerato, che si allarga quando si recluta.')
		],
		pplat: o => [
			E(V('Pplat', o.pplat, 1, 'pplat'), [V('PEEPtot', o.peepTot, 1, 'peeptot'), '+', F([V('VT', o.vt, 0, 'vt')], [V('Crs', o.crs, 0, 'crs')])]),
			E(V('Ppicco', o.ppeak, 1), o.mode === 'VC'
				? [V('Pplat', o.pplat, 1, 'pplat'), '+', V('Raw', o.raw, 0, 'raw'), '·', V('Flusso', o.x.flowLs, 2)]
				: ['pressione impostata'])
		],
		dp: o => [
			E(V('ΔP', o.dp, 1, 'dp'), [V('Pplat', o.pplat, 1, 'pplat'), '−', V('PEEPtot', o.peepTot, 1, 'peeptot')]),
			E(V('ΔP', o.dp, 1, 'dp'), [F([V('VT', o.vt, 0, 'vt')], [V('Crs', o.crs, 0, 'crs')])])
		],
		overdist: o => [
			E(V('Sovradist', o.overdist / 100, 2, 'overdist'), ['clamp', '(', F([V('riempim', o.x.fillInsp, 2), '−', K(0.55)], [K(0.35)]), ')']),
			E(V('riempim', o.x.fillInsp, 2), [F([V('V_PEEP', o.x.vpeep, 0), '+', V('VT', o.vt, 0, 'vt')], [V('Vmax aerato', o.x.vmax, 0)])])
		],
		mpaw: o => [
			E(V('mPaw', o.mpaw, 1, 'mpaw'), [F([K(1)], [V('Ttot', o.x.ttot, 2)]), '·', '∫', 'Paw', 'dt'], 'Media della curva di pressione del monitor su un ciclo respiratorio.')
		],
		mp: o => [
			E(V('MP', o.mp, 1, 'mp'), [K(0.098), '·', V('FR', o.rr, 0, 'rr'), '·', '∫', 'Paw', 'dV'], 'Energia del ventilatore per atto (J) × frequenza.'),
			E(V('MP ≈', 0.098 * o.rr * o.vt / 1000 * (o.ppeak - o.dp / 2), 1), [K(0.098), '·', V('FR', o.rr, 0, 'rr'), '·', V('VT L', o.vt / 1000, 2, 'vt'), '·', '(', V('Ppicco', o.ppeak, 1), '−', F([V('ΔP', o.dp, 1, 'dp')], [K(2)]), ')'], 'Formula semplificata di Gattinoni, per confronto.')
		],
		eelv: o => [
			E(V('EELV', o.eelv, 0, 'eelv'), [V('CFR aerata', o.x.frc, 0), '+', V('V_PEEP', o.x.vpeep, 0)]),
			E(V('CFR aerata', o.x.frc, 0), [F([K(25), '·', V('PBW', o.pbw, 0), '·', V('aerazione', o.x.aerExp, 2, 'recruit'), '·', '(', K(1), '+', K(0.4), '·', V('enfisema', o.x.copdE, 2), ')'],
				[K(1), '+', K(o.x.cal.obesFrc), '·', V('obesità', o.x.obes, 2), '+', K(0.02), '·', V('IAP − 7', o.x.iapX, 1, 'iap')])], 'Supino e sedato: obesità e addome teso riducono la capacità funzionale residua.')
		],
		strain: o => [
			E(V('strain', o.strain, 2, 'strain'), [F([V('VT', o.vt, 0, 'vt'), '+', V('V_PEEP', o.x.vpeep, 0)], [V('CFR aerata', o.x.frc, 0)])])
		],
		ppl: o => [
			E(V('Ppl₀', o.x.ppl0, 1), [K(3), '+', K(4), '·', V('obesità', o.x.obes, 2), '+', K(0.4), '·', V('IAP − 7', o.x.iapX, 1, 'iap')], 'Pressione pleurica a fine espirazione in ZEEP, supino: circa il 30% della pressione addominale in eccesso arriva alla pleura.'),
			E(V('Ppl', o.pplMean, 1, 'ppl'), [V('Ppl₀', o.x.ppl0, 1), '+', F([V('V̄', o.x.vMeanAbove, 0)], [V('Ccw', o.ccw, 0, 'ccw')]), '−', V('P̄mus', o.x.pmusMean, 1)],
				'V̄: volume medio sopra la CFR nel ciclo. La parete toracica converte il volume in pressione pleurica.')
		],
		ptp: o => [
			E(V('PL', o.ptp, 1, 'ptp'), [V('Pplat', o.pplat, 1, 'pplat'), '−', V('Ppl fine insp', o.x.pplPlat, 1)]),
			E(V('Ppl fine insp', o.x.pplPlat, 1), [V('Ppl₀', o.x.ppl0, 1), '+', F([V('V_PEEP', o.x.vpeep, 0), '+', V('VT', o.vt, 0, 'vt')], [V('Ccw', o.ccw, 0, 'ccw')])])
		],

		/* ------------------------------------------------------- gas exchange */
		shunt: o => [
			E(V('Qs/Qt', o.shunt / 100, 3, 'shunt'), [K(0.02), '+', V('non aerato', o.x.nonAerMean, 2, 'recruit'), '·', K(0.7), '·', P(['(', F([V('GC', o.co, 2, 'co')], [V('GC₀', o.x.co0, 2)]), ')'], [K(0.35)]),
				'+', K(0.35), '·', V('shunt pat', o.x.shuntSev, 2), '+', K(0.15), '·', V('sovradist', o.overdist / 100, 2, 'overdist'), '·', V('non aerato', o.x.nonAerMean, 2, 'recruit')])
		],
		vdvt: o => [
			E(V('VD/VT', o.vdvt / 100, 2, 'vdvt'), [K(1), '−', F([V('VA', o.va * 1000, 0, 'va')], [V('FR', o.rr, 0, 'rr'), '·', V('VT', o.vt, 0, 'vt')])]),
			E(V('VD alveolare', o.x.vdAlv, 2), [K(0.05), '+', K(0.3), '·', V('sovradist', o.overdist / 100, 2, 'overdist'), '+', K(0.25), '·', '(', V('ARDS', o.x.ards, 2), '+', V('enfisema', o.x.copdE, 2), '+',
				'max', '(', K(0), ',', K(1), '−', F([V('GC', o.co, 2, 'co')], [V('GC₀', o.x.co0, 2)]), ')', ')', '+', V('zona 1', o.x.zone1, 2)])
		],
		va: o => [
			E(V('VA', o.va, 2, 'va'), [V('FR', o.rr, 0, 'rr'), '·', '(', V('VT', o.vt, 0, 'vt'), '−', V('VD anat', o.x.vdAnat, 0), ')', '·', '(', K(1), '−', V('VD alv', o.x.vdAlv, 2, 'vdvt'), ')', '/', K(1000)])
		],
		paco2: o => [
			E(V('dPaCO₂/dt', o.x.dPaco2PerMin, 2), [F([V('VCO₂', o.x.vco2, 0), '−', V('VA', o.va, 2, 'va'), '·', V('PaCO₂', o.paco2, 1, 'paco2'), '/', K(0.863)], [K(o.x.cal.co2Store)])],
				'mmHg/min: produzione meno eliminazione di CO₂, divise per i depositi corporei (25 mL/mmHg). Positivo = la PaCO₂ sta salendo.'),
			E(V('PaCO₂ equilibrio', o.va > 0 ? 0.863 * o.x.vco2 / o.va : NaN, 0), [F([K(0.863), '·', V('VCO₂', o.x.vco2, 0)], [V('VA', o.va, 2, 'va')])], 'Valore verso cui tende la PaCO₂ se la ventilazione non cambia.')
		],
		etco2: o => [
			E(V('EtCO₂', o.etco2, 1, 'etco2'), [V('PaCO₂', o.paco2, 1, 'paco2'), '·', '(', K(1), '−', V('VD alv', o.x.vdAlv, 2, 'vdvt'), ')', '·', '(', K(1), '−', K(0.1), '·', V('Qs/Qt', o.shunt / 100, 2, 'shunt'), ')'])
		],
		pao2: o => [
			E(V('CaO₂', o.cao2, 2, 'cao2'), [F([
				'(', K(1), '−', V('Qs', o.shunt / 100, 2, 'shunt'), '−', V('Qlow', o.x.lowVQ, 2), ')', '·', V("Cc'O₂", o.x.cc, 2), '+', V('Qlow', o.x.lowVQ, 2), '·', V('Clow', o.x.clow, 2), '−', V('Qs', o.shunt / 100, 2, 'shunt'), '·', V('ΔavO₂', o.x.avd, 2)
			], [K(1), '−', V('Qs', o.shunt / 100, 2, 'shunt')])], 'Tre compartimenti: capillari ventilati, basso V/Q e shunt (sangue venoso misto, CvO₂ = CaO₂ − ΔavO₂).'),
			E(V('PaO₂', o.pao2, 0, 'pao2'), ['S⁻¹', '(', V('CaO₂', o.cao2, 2, 'cao2'), ')'], 'La PaO₂ si ricava invertendo la curva di dissociazione dal contenuto arterioso.')
		],
		spo2: o => [
			E(V('SaO₂', o.sao2 / 100, 3), [F([K(1)], [F([K(23400)], [P([V('PaO₂', o.pao2, 0, 'pao2')], [K(3)]), '+', K(150), '·', V('PaO₂', o.pao2, 0, 'pao2')]), '+', K(1)])], 'Curva di Severinghaus. La SpO₂ la segue con un ritardo di ~8 s.')
		],
		pf: o => [
			E(V('P/F', o.pf, 0, 'pf'), [F([V('PaO₂', o.pao2, 0, 'pao2')], [V('FiO₂', o.fio2, 2, 'fio2')])])
		],

		/* ------------------------------------------------------- hemodynamics */
		pmsf: o => [
			E(V('Pmsf', o.pmsf, 1, 'pmsf'), [K(o.x.cal.pmsf0), '+', '(', V('volemia', o.volemia / 100, 2, 'volemia'), '−', K(1), ')', '·', F([V('VS', o.x.bv, 0)], [K(2.8), '·', V('peso', o.x.weight, 0)]), '+', K(3), '·', V('LVD', o.x.lvd, 2),
				'+', K(3.5), '·', V('simpatico', o.symp / 100, 2, 'symp'), '+', K(o.x.cal.pmsfPpl), '·', 'max', '(', K(0), ',', V('Ppl', o.pplMeanMmHg, 1, 'ppl'), '−', V('Ppl₀', o.x.ppl0 * MM, 1), ')'],
				'mmHg. L\'ultimo termine è la compressione addominale da parte della PEEP (compenso parziale).')
		],
		rap: o => EQ.co(o),
		vrg: o => [
			E(V('ΔP ritorno', o.vrGradient, 1, 'vrg'), [V('Pmsf', o.pmsf, 1, 'pmsf'), '−', V('PVC', Math.max(0, o.rap), 1, 'rap')])
		],
		pvr: o => [
			E(V('PVR', o.x.pvrWU, 2, 'pvr'), [V('PVR₀', o.x.pvr0, 2), '·', V('collasso', o.x.pvrLow, 2, 'recruit'), '·', V('sovradist', o.x.pvrHigh, 2, 'overdist'), '·', V('HPV', o.x.pvrHpv, 2, 'pao2'), '·', V('acidosi', o.x.pvrAcid, 2, 'ph'), '·', V('malattia', o.x.pvrDisease, 2)],
				'Unità Wood (× 80 = dyn·s·cm⁻⁵). Ogni fattore vale 1 in condizioni normali.'),
			E(V('collasso', o.x.pvrLow, 2), [K(1), '+', K(1.2), '·', 'max', '(', K(0), ',', K(1), '−', V('aerazione', o.x.aerExp, 2, 'recruit'), '−', K(0.05), ')'])
		],
		mpap: o => {
			const H = o.x.hydroSpan, D = o.x.palv - o.pawp;
			const excess = D <= -H / 2
				? E(V('eccesso', o.x.waterfall, 1), [K(0)], 'Zona 3 in tutto il polmone: la pressione alveolare è sotto quella venosa ovunque, a valle conta la PAWP.')
				: D >= H / 2
					? E(V('eccesso', o.x.waterfall, 1), [V('P alv', o.x.palv, 1, 'mpaw'), '−', V('PAWP', o.pawp, 1)], 'Tutto il polmone in zona 1-2: a valle conta la pressione alveolare.')
					: E(V('eccesso', o.x.waterfall, 1), [F([P(['(', V('P alv', o.x.palv, 1, 'mpaw'), '−', V('PAWP', o.pawp, 1), '+', F([V('H', H, 0)], [K(2)]), ')'], [K(2)])], [K(2), '·', V('H', H, 0)])],
						'Media lungo l\'altezza del polmone (H = gradiente idrostatico, atrio sinistro a metà altezza) della quota di pressione alveolare che supera quella venosa locale.');
			return [
				E(V('mPAP', o.mpap, 0, 'mpap'), [V('P valle', o.x.pOut, 1), '+', V('GC', o.co, 2, 'co'), '·', V('PVR', o.x.pvrWU, 2, 'pvr')]),
				E(V('P valle', o.x.pOut, 1), [V('PAWP', o.pawp, 1), '+', V('eccesso', o.x.waterfall, 1)], 'Pressione a valle del circolo polmonare (cascata vascolare delle zone di West).'),
				excess,
				E(V('zona 1-2', o.x.zone12, 2), ['clamp', '(', F([V('P alv', o.x.palv, 1, 'mpaw'), '−', V('PAWP', o.pawp, 1), '+', F([V('H', H, 0)], [K(2)])], [V('H', H, 0)]), ')'], 'Frazione di polmone in cui la pressione alveolare supera quella venosa. P alv = pressione media delle vie aeree in mmHg.'),
				E(V('PAWP', o.pawp, 1), [V('Ppl', o.pplMeanMmHg, 1, 'ppl'), '+', V('P transm. AS', o.x.lapTm, 1)], 'La pressione pleurica si somma alla pressione transmurale dell\'atrio sinistro.')
			];
		},
		rvfunc: o => {
			const r = o.x.rvCoupling;
			return [
				r >= 1.2
					? E(V('f VD →', o.x.rvTarget, 2), [K(1)], 'Accoppiamento buono (Ees/Ea ≥ 1,2): il VD regge il postcarico.')
					: E(V('f VD →', o.x.rvTarget, 2), ['max', '(', K(0.5), ',', F([K(1)], [K(1), '+', P(['(', K(1.2), '−', V('Ees/Ea', r, 2), ')'], [K(2)])]), ')'], 'Il VD si sta disaccoppiando dall\'arteria polmonare.'),
				E(V('Ees/Ea', r, 2), [F([V('Ees', o.x.eesRV, 2)], [V('Ea', o.x.eaRV, 2)])], 'Ees: elastanza telesistolica del VD (contrattilità), indicizzata alla superficie corporea.'),
				E(V('Ea', o.x.eaRV, 2), [F([V('mPAP', o.mpap, 1, 'mpap'), '−', V('Ppl', o.pplMeanMmHg, 1, 'ppl')], [V('GSi', o.sv / o.bsa, 1, 'sv')])], 'Postcarico del VD: pressione polmonare transmurale per unità di gittata sistolica indicizzata (mL/m²).'),
				E(V('f VD', o.rvFunc / 100, 2, 'rvfunc'), ['→', V('bersaglio', o.x.rvTarget, 2), '  (τ = 4 s)'])
			];
		},
		ppv: o => [
			E(V('PPV', o.ppv, 1, 'ppv'), [K(2), '+', K(o.x.cal.ppvGain), '·', F([V('ΔPpl tidal', o.x.swing, 2, 'ppl'), '·', V('pendenza Starling', o.x.slope, 2)], [V('GC', o.co, 2, 'co')])],
				'La pendenza è dGC/dPVC al punto di lavoro: alta nel paziente precarico-dipendente (ipovolemia).')
		],
		lvtm: o => [
			E(V('P transm. VS', o.lvTransmural, 0, 'lvtm'), [V('PAS', o.sbp, 0, 'map'), '−', V('Ppl', o.pplMeanMmHg, 1, 'ppl')])
		],
		symp: o => [
			E(V('simpatico →', o.x.sympTarget, 2), [K(5), '·', F([V('PAM₀', o.x.map0, 0), '−', V('PAM', o.map, 0, 'map')], [V('PAM₀', o.x.map0, 0)]), '+', V('chemo', o.x.chemo, 2, 'pao2'), '+', V('stress', o.x.stress, 2)],
				'Il tono simpatico attuale insegue questo valore con costante di tempo 10 s.'),
			E(V('simpatico', o.symp / 100, 2, 'symp'), ['→', V('bersaglio', o.x.sympTarget, 2), '  (τ = 10 s)'])
		],
		hr: o => [
			E(V('FC →', o.x.hrBase * (1 + 0.5 * o.symp / 100), 0), [V('FC base', o.x.hrBase, 0), '·', '(', K(1), '+', K(0.5), '·', V('simpatico', o.symp / 100, 2, 'symp'), ')'], 'La FC insegue questo valore con costante di tempo 5 s.')
		],
		co: o => [
			E(V('GC', o.co, 2, 'co'), [F([V('Pmsf', o.pmsf, 1, 'pmsf'), '−', V('PVC', Math.max(0, o.rap), 1, 'rap')], [V('RVR', o.x.rvr, 2)])], 'Ritorno venoso (Guyton).'),
			E(V('GC', o.co, 2, 'co'), [V('GCmax', o.x.comax, 2), '·', '(', K(1), '−', P(['e'], ['−', F([V('Ptm', o.x.ptm, 1)], [V('k', o.x.kp, 1)])]), ')'], 'Curva di Starling. Il cuore lavora dove le due curve si incontrano.'),
			E(V('Ptm', o.x.ptm, 1), [V('PVC', o.rap, 1, 'rap'), '−', V('Ppl', o.pplMeanMmHg, 1, 'ppl'), '−', V('Ppericard', o.ppc, 1)], 'Pressione transmurale: il vero precarico.'),
			E(V('GCmax', o.x.comax, 2), [V('GCmax₀', o.x.comax / (o.x.hrFactor * o.x.contractF * o.rvFunc / 100 * o.x.lvUnload), 2), '·', V('f FC', o.x.hrFactor, 2, 'hr'), '·', V('f contratt', o.x.contractF, 2, 'contract'), '·', V('f VD', o.rvFunc / 100, 2, 'rvfunc'), '·', V('scarico VS', o.x.lvUnload, 2, 'lvtm')])
		],
		sv: o => [
			E(V('GS', o.sv, 0, 'sv'), [F([V('GC', o.co, 2, 'co')], [V('FC', o.hr, 0, 'hr')]), '·', K(1000)])
		],
		svr: o => [
			E(V('RVS', o.x.svrWU, 2, 'svr'), [V('RVS₀', o.x.svr0, 2), '·', '(', K(1), '+', K(0.4), '·', V('simpatico', o.symp / 100, 2, 'symp'), ')', '·', V('f pH', o.x.svrAcid, 2, 'ph')], 'Unità Wood (× 80 = dyn·s·cm⁻⁵).')
		],
		map: o => [
			E(V('PAM', o.map, 0, 'map'), [V('GC', o.co, 2, 'co'), '·', V('RVS', o.x.svrWU, 2, 'svr'), '+', V('PVC', o.rap, 1, 'rap')]),
			E(V('PP', o.sbp - o.dbp, 0), ['∝', V('GS', o.sv, 0, 'sv'), '    ', 'PAS = PAM + ⅔·PP', '  ', 'PAD = PAM − ⅓·PP'])
		],

		/* --------------------------------------------- oxygen transport */
		hb: o => [
			E(V('Hb', o.hb, 1, 'hb'), [V('Hb₀', o.x.hb0, 1), '·', F([V('VS', o.x.bv, 0)], [V('VS', o.x.bv, 0), '+', V('fluidi', Math.max(0, o.x.fluid), 0)])], 'Hb₀ include l\'eventuale anemia cronica.')
		],
		cao2: o => [
			E(V('CaO₂', o.cao2, 2, 'cao2'), [K(1.34), '·', V('Hb', o.hb, 1, 'hb'), '·', V('SaO₂', o.sao2 / 100, 3, 'spo2'), '+', K(0.003), '·', V('PaO₂', o.pao2, 0, 'pao2')])
		],
		do2: o => [
			E(V('DO₂', o.do2, 0, 'do2'), [V('GC', o.co, 2, 'co'), '·', V('CaO₂', o.cao2, 2, 'cao2'), '·', K(10)])
		],
		vo2: o => [
			E(V('VO₂', o.vo2, 0, 'vo2'), ['(', V('CaO₂', o.cao2, 2, 'cao2'), '−', V('CvO₂', o.cvo2, 2), ')', '·', K(10), '·', V('GC', o.co, 2, 'co')], 'Fick. Coincide con la richiesta finché l\'estrazione resta sotto l\'80%.'),
			E(V('richiesta', o.x.vo2Demand, 0), [V('VO₂ basale', o.x.vo2Basal, 0), '·', '(', K(1), '+', K(0.12), '·', V('simpatico', Math.max(0, o.symp / 100), 2, 'symp'), ')', '+', K(25), '·', '(', K(1), '−', V('sedaz', o.sedation, 2), ')'])
		],
		svo2: o => [
			E(V('CvO₂', o.cvo2, 2), [V('CaO₂', o.cao2, 2, 'cao2'), '−', F([V('VO₂', o.vo2, 0, 'vo2')], [K(10), '·', V('GC', o.co, 2, 'co')])]),
			E(V('SvO₂', o.svo2 / 100, 3, 'svo2'), ['S', '(', V('PvO₂', o.x.pvo2, 1), ')'], 'Estrazione = VO₂ / DO₂.')
		],
		lactate: o => [
			E(V('lattato →', o.x.lacTarget, 2), [K(1), '+', K(18), '·', 'max', '(', K(0), ',', V('estrazione', o.o2er / 100, 2, 'svo2'), '−', K(0.45), ')', '+', K(0.08), '·', 'max', '(', K(0), ',', K(60), '−', V('PAM', o.map, 0, 'map'), ')'],
				'Il lattato insegue questo valore con costante di tempo 4 min.'),
			E(V('lattato', o.lactate, 2, 'lactate'), ['→', V('bersaglio', o.x.lacTarget, 2), '  (τ = 240 s)'])
		],
		ph: o => [
			E(V('pH', o.ph, 2, 'ph'), [K(6.1), '+', 'log₁₀', F([V('HCO₃⁻', o.hco3, 1)], [K(0.03), '·', V('PaCO₂', o.paco2, 1, 'paco2')])]),
			E(V('HCO₃⁻', o.hco3, 1), [K(24), '−', '(', V('lattato', o.lactate, 2, 'lactate'), '−', K(1), ')', '+', K(0.1), '·', '(', V('PaCO₂', o.paco2, 1, 'paco2'), '−', K(40), ')'])
		]
	};

	/* ============================================================ view */

	const fmt = (v, d) => !isFinite(v) ? '–' : Number(v).toFixed(d).replace('-', '−');

	class EquationView {

		constructor() {
			this.nodeId = null;
			this.trail = [];
			this.nums = [];
			this.signature = '';
			this.onNavigate = null;
			this.simple = false;
			try { this.simple = localStorage.getItem('breathe-eq-simple') === '1'; } catch (e) { /* storage unavailable */ }
			this.build();
		}

		build() {
			const el = document.createElement('section');
			el.className = 'eqv';
			el.hidden = true;
			el.setAttribute('role', 'dialog');
			el.setAttribute('aria-label', 'Equazioni dal vivo');
			el.innerHTML =
				'<header class="eqv-head">' +
				'<span class="eqv-dot"></span><div class="eqv-titles"><span class="eqv-kicker">Equazioni dal vivo</span><h2 class="eqv-title"></h2></div>' +
				'<div class="eqv-mode" role="radiogroup" aria-label="Tipo di formula"><button type="button" data-simple="0" role="radio">Completa</button><button type="button" data-simple="1" role="radio">Semplificata</button></div>' +
				'<button type="button" class="eqv-close" aria-label="Chiudi">×</button></header>' +
				'<nav class="eqv-trail" aria-label="Percorso"></nav>' +
				'<div class="eqv-body"></div>' +
				'<footer class="eqv-foot">Valori del paziente simulato, aggiornati in tempo reale. Clicca una variabile sottolineata per risalire alla sua equazione.</footer>';
			document.body.appendChild(el);
			this.el = el;
			this.titleEl = el.querySelector('.eqv-title');
			this.dotEl = el.querySelector('.eqv-dot');
			this.body = el.querySelector('.eqv-body');
			this.trailEl = el.querySelector('.eqv-trail');
			el.querySelector('.eqv-close').addEventListener('click', () => this.close());
			el.querySelectorAll('.eqv-mode button').forEach(b => b.addEventListener('click', () => this.setSimple(b.dataset.simple === '1')));
			this.syncMode();
			document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && !this.el.hidden) this.close(); });
			this.makeDraggable(el.querySelector('.eqv-head'));
		}

		makeDraggable(handle) {
			let drag = null;
			handle.addEventListener('pointerdown', ev => {
				if (ev.target.closest('button') || window.innerWidth < 700) return;
				const r = this.el.getBoundingClientRect();
				drag = { dx: ev.clientX - r.left, dy: ev.clientY - r.top };
				handle.setPointerCapture(ev.pointerId);
			});
			handle.addEventListener('pointermove', ev => {
				if (!drag) return;
				const x = Math.min(window.innerWidth - 80, Math.max(0, ev.clientX - drag.dx));
				const y = Math.min(window.innerHeight - 60, Math.max(0, ev.clientY - drag.dy));
				Object.assign(this.el.style, { left: x + 'px', top: y + 'px', right: 'auto', bottom: 'auto' });
			});
			handle.addEventListener('pointerup', () => { drag = null; });
		}

		has(id) { return !!EQ[id]; }

		//Simplified view: the one-line idea of the node with its live value, instead of the full equations
		setSimple(on) {
			this.simple = !!on;
			try { localStorage.setItem('breathe-eq-simple', on ? '1' : '0'); } catch (e) { /* storage unavailable */ }
			this.syncMode();
			if (this.lastO) this.update(this.lastO, true);
		}

		syncMode() {
			this.el.querySelectorAll('.eqv-mode button').forEach(b => {
				const on = (b.dataset.simple === '1') === this.simple;
				b.classList.toggle('on', on);
				b.setAttribute('aria-checked', on);
			});
		}

		renderSimple(o, frozen) {
			const node = global.BreatheNodes.byId[this.nodeId];
			this.body.innerHTML = '';
			this.nums = []; this.blocks = [];
			this.body.classList.toggle('frozen', frozen);
			if (frozen) this.body.append(this.frozenBanner(o));
			const block = document.createElement('div');
			block.className = 'eq eq-simple';
			const f = document.createElement('p');
			f.className = 'eq-simple-f';
			f.textContent = node.simple;
			const v = document.createElement('p');
			v.className = 'eq-simple-v';
			v.innerHTML = '<span class="eq-var eq-result"></span> <span class="eq-op">=</span> <span class="eq-val eq-result"></span> <span class="eq-simple-u"></span>';
			v.querySelector('.eq-var').textContent = node.labelFn ? node.labelFn(o) : node.label;
			const valEl = v.querySelector('.eq-val');
			valEl.textContent = fmt(global.BreatheNodes.nodeValue(node, o), node.dec);
			v.querySelector('.eq-simple-u').textContent = node.unitFn ? node.unitFn(o) : node.unit;
			this.nums.push({ el: valEl, target: global.BreatheNodes.nodeValue(node, o), d: node.dec });
			const n = document.createElement('p');
			n.className = 'eq-note';
			n.textContent = node.desc;
			block.append(f, v, n);
			this.body.append(block);
			this.blocks.push(block);
		}

		frozenBanner(o) {
			const node = global.BreatheNodes.byId[this.nodeId];
			const b = document.createElement('p');
			b.className = 'eqv-frozen';
			b.textContent = 'Nodo disattivato: il valore resta fisso a ' + fmt(global.BreatheNodes.nodeValue(node, o), node.dec) + ' ' +
				(node.unitFn ? node.unitFn(o) : node.unit) + ' e non risente dei nodi a monte. Le equazioni qui sotto mostrano cosa varrebbe se fosse attivo.';
			return b;
		}

		open(id, o, fromTrail) {
			if (!EQ[id]) return;
			const node = global.BreatheNodes.byId[id];
			const cat = global.BreatheNodes.CATEGORIES[node.cat];
			if (!fromTrail) {
				const i = this.trail.indexOf(id);
				if (i >= 0) this.trail = this.trail.slice(0, i + 1);
				else this.trail = this.nodeId && !this.el.hidden ? this.trail.concat(id).slice(-6) : [id];
			}
			this.nodeId = id;
			this.titleEl.textContent = node.labelFn ? node.labelFn(o) : node.label;
			this.dotEl.style.background = cat.color;
			this.el.style.setProperty('--eq-accent', cat.color);
			this.el.hidden = false;
			this.renderTrail();
			this.signature = '';
			this.update(o, true);
		}

		close() { this.el.hidden = true; this.nodeId = null; this.trail = []; }

		renderTrail() {
			this.trailEl.innerHTML = '';
			this.trailEl.hidden = this.trail.length < 2;
			this.trail.forEach((id, i) => {
				if (i) this.trailEl.append(Object.assign(document.createElement('span'), { className: 'eqv-sep', textContent: '→' }));
				const b = document.createElement('button');
				b.type = 'button';
				b.className = 'eqv-crumb' + (id === this.nodeId ? ' on' : '');
				b.textContent = global.BreatheNodes.byId[id].label;
				b.addEventListener('click', () => this.navigate(id));
				this.trailEl.append(b);
			});
		}

		navigate(id) {
			if (this.onNavigate) this.onNavigate(id);
		}

		//Rebuild when the structure changes (e.g. ventilation mode), otherwise only animate numbers
		update(o, force) {
			this.lastO = o;
			if (this.el.hidden || !this.nodeId) return;
			const frozen = !!(o.frozen && o.frozen.indexOf(this.nodeId) >= 0);
			if (this.simple) {
				const node = global.BreatheNodes.byId[this.nodeId];
				const key = 'simple|' + frozen + '|' + this.nodeId;
				if (force || key !== this.signature) { this.signature = key; this.renderSimple(o, frozen); }
				else this.setNum(this.nums[0], global.BreatheNodes.nodeValue(node, o));
				return;
			}
			const eqs = EQ[this.nodeId](o);
			const sig = (frozen ? 'F' : '') + JSON.stringify(eqs, (k, v) => (k === 'v' ? undefined : v));
			if (force || sig !== this.signature) {
				this.signature = sig;
				this.render(eqs, frozen, o);
				return;
			}
			let i = 0;
			const changedEq = new Set();
			eqs.forEach((eq, ei) => {
				const walk = t => {
					if (Array.isArray(t)) return t.forEach(walk);
					if (t && typeof t === 'object') {
						if (t.f) return t.f.forEach(walk);
						if (t.sup) return t.sup.forEach(walk);
						if (t.s !== undefined) { if (this.setNum(this.nums[i++], t.v)) changedEq.add(ei); }
					}
				};
				walk([eq.lhs]);
				walk(eq.rhs);
			});
			changedEq.forEach(ei => {
				const block = this.blocks[ei];
				block.classList.remove('sweep');
				void block.offsetWidth; // restart the animation
				block.classList.add('sweep');
			});
		}

		setNum(rec, v) {
			if (!rec) return false;
			const old = rec.target;
			rec.target = v;
			const step = Math.pow(10, -rec.d);
			if (!isFinite(v) || !isFinite(old)) { rec.el.textContent = fmt(v, rec.d); rec.shown = v; return false; }
			if (Math.abs(v - old) < step / 2) return false;
			rec.el.classList.remove('up', 'down');
			void rec.el.offsetWidth;
			rec.el.classList.add(v > old ? 'up' : 'down');
			this.tween(rec, old, v);
			return true;
		}

		tween(rec, from, to) {
			const t0 = performance.now(), dur = 450;
			const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
			if (reduce) { rec.el.textContent = fmt(to, rec.d); return; }
			const tick = now => {
				if (rec.target !== to) return; // superseded by a newer value
				const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
				rec.el.textContent = fmt(from + (to - from) * e, rec.d);
				if (k < 1) requestAnimationFrame(tick);
			};
			requestAnimationFrame(tick);
		}

		render(eqs, frozen, o) {
			this.body.innerHTML = '';
			this.nums = [];
			this.blocks = [];
			this.body.classList.toggle('frozen', !!frozen);
			if (frozen) this.body.append(this.frozenBanner(o));
			eqs.forEach(eq => {
				const block = document.createElement('div');
				block.className = 'eq';
				const sym = document.createElement('div');
				sym.className = 'eq-row eq-sym';
				const num = document.createElement('div');
				num.className = 'eq-row eq-num';
				this.renderSide(sym, eq, 'sym');
				this.renderSide(num, eq, 'num');
				//very wide formulas scroll sideways instead of being cut off
				const lines = document.createElement('div');
				lines.className = 'eq-lines';
				lines.append(sym, num);
				block.append(lines);
				if (eq.note) {
					const n = document.createElement('p');
					n.className = 'eq-note';
					n.textContent = eq.note;
					block.append(n);
				}
				this.body.append(block);
				this.blocks.push(block);
			});
			this.body.classList.remove('enter');
			void this.body.offsetWidth;
			this.body.classList.add('enter');
		}

		renderSide(row, eq, mode) {
			const lhs = document.createElement('span');
			lhs.className = 'eq-lhs';
			this.renderTokens(lhs, [eq.lhs], mode, true);
			const eqSign = document.createElement('span');
			eqSign.className = 'eq-op eq-eq';
			eqSign.textContent = '=';
			const rhs = document.createElement('span');
			rhs.className = 'eq-rhs';
			this.renderTokens(rhs, eq.rhs, mode, false);
			row.append(lhs, eqSign, rhs);
		}

		renderTokens(parent, tokens, mode, isLhs) {
			tokens.forEach(t => {
				if (typeof t === 'string') {
					const s = document.createElement('span');
					s.className = /^[a-zà-ù ]{4,}/i.test(t) && t.length > 6 ? 'eq-text' : 'eq-op';
					s.textContent = t;
					parent.append(s);
				} else if (t.f) {
					const fr = document.createElement('span');
					fr.className = 'eq-frac';
					const nu = document.createElement('span'), de = document.createElement('span');
					nu.className = 'eq-numer'; de.className = 'eq-denom';
					this.renderTokens(nu, t.f[0], mode, false);
					this.renderTokens(de, t.f[1], mode, false);
					fr.append(nu, de);
					parent.append(fr);
				} else if (t.sup) {
					const base = document.createElement('span');
					base.className = 'eq-pow';
					this.renderTokens(base, t.sup[0], mode, false);
					const sup = document.createElement('sup');
					this.renderTokens(sup, t.sup[1], mode, false);
					base.append(sup);
					parent.append(base);
				} else if (t.c !== undefined) {
					const s = document.createElement('span');
					s.className = 'eq-const';
					s.textContent = fmt(t.c, t.d);
					parent.append(s);
				} else if (t.s !== undefined) {
					const el = document.createElement(t.n && !isLhs ? 'button' : 'span');
					if (el.tagName === 'BUTTON') {
						el.type = 'button';
						el.title = 'Vai a: ' + global.BreatheNodes.byId[t.n].label;
						el.addEventListener('click', () => this.navigate(t.n));
					}
					if (mode === 'sym') {
						el.className = 'eq-var' + (isLhs ? ' eq-result' : '') + (t.n && !isLhs ? ' eq-link' : '');
						el.textContent = t.s;
					} else {
						el.className = 'eq-val' + (isLhs ? ' eq-result' : '') + (t.n && !isLhs ? ' eq-link' : '');
						el.textContent = fmt(t.v, t.d);
						this.nums.push({ el, target: t.v, d: t.d });
					}
					parent.append(el);
				}
			});
		}
	}

	global.BreatheEquations = { EQ, EquationView };
})(typeof window !== 'undefined' ? window : globalThis);
