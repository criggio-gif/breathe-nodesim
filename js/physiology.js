/*
 * BREATHE NodeSim - physiology model
 *
 * Lumped, explanatory model of an intubated, mechanically ventilated patient.
 * It is NOT a replacement for the Pulse engine used by breathe.engine: it trades
 * accuracy for transparency, so that every variable is a "node" whose value can
 * be traced back to the nodes it depends on.
 *
 * Parameter names mirror breathe.engine:
 *  - patient    -> data.Patient   (Age, Weight, Height, HeartRateBaseline, ...)
 *  - ventilator -> data.Ventilator (PositiveEndExpiratoryPressure, TidalVolume, ...)
 *  - conditions -> data.Condition  ("ARDS", "COPD", "Pneumonia", ...)
 *  - actions    -> data.Action     ("Bronchoconstriction", "Airway Obstruction", ...)
 *
 * Units: pressures of the respiratory system in cmH2O, vascular pressures in mmHg,
 * volumes in mL, flows in L/min, time in seconds.
 */
(function (global) {
	'use strict';

	const CMH2O_TO_MMHG = 0.7355;
	const EES_RV_INDEXED = 0.9; // RV end-systolic elastance, mmHg/(mL/m²)
	const P_ATM = 760, P_H2O = 47;

	const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
	const relax = (x, target, dt, tau) => x + (target - x) * (1 - Math.exp(-dt / tau));
	const avg = (a, b) => ((a || 0) + (b || 0)) / 2;

	//Standard normal CDF (Abramowitz-Stegun 26.2.17)
	function phi(z) {
		const t = 1 / (1 + 0.2316419 * Math.abs(z));
		const d = 0.3989423 * Math.exp(-z * z / 2);
		const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
		return z > 0 ? 1 - p : p;
	}

	//Monotone increasing f: find x in [lo, hi] with f(x) = y
	function invert(f, y, lo, hi, iter) {
		for (let i = 0; i < (iter || 40); i++) {
			const mid = (lo + hi) / 2;
			if (f(mid) < y) lo = mid; else hi = mid;
		}
		return (lo + hi) / 2;
	}

	//Severinghaus oxyhemoglobin dissociation curve
	function satFromPO2(p) {
		p = Math.max(p, 0.1);
		return 1 / (23400 / (p * p * p + 150 * p) + 1);
	}
	function o2Content(po2, hb) { // mL O2 / dL
		return 1.34 * hb * satFromPO2(po2) + 0.003 * po2;
	}
	function po2FromContent(c, hb) {
		return invert(p => o2Content(p, hb), c, 0.1, 700, 36);
	}

	const DEFAULT_PATIENT = {
		Name: 'Standard',
		Sex: 'M',
		Age: 44,
		Weight: 77,
		Height: 180,
		BodyFatFraction: 0.21,
		HeartRateBaseline: 72,
		SystolicArterialPressureBaseline: 114,
		DiastolicArterialPressureBaseline: 72,
		RespirationRateBaseline: 12,
		BasalMetabolicRate: 1600,
		//NodeSim only: circulating volume (1 = normovolemia) and depth of sedation (1 = no spontaneous effort)
		Volemia: 1.0,
		Sedation: 1.0
	};

	const DEFAULT_VENTILATOR = {
		mode: 'VC', // VC, PC, CPAP (utils.VentilationMode)
		AssistedMode: 0, // AC = 0, CMV = 1
		Flow: 60,
		FractionInspiredOxygen: 0.5,
		InspiratoryPeriod: 1.0,
		PositiveEndExpiratoryPressure: 5,
		RespirationRate: 16,
		TidalVolume: 500,
		InspiratoryPressure: 22,
		Slope: 0.2,
		DeltaPressureSupport: 10
	};

	const DEFAULT_ACTIONS = {
		'Bronchoconstriction': 0,
		'Airway Obstruction': 0,
		'Acute Stress': 0,
		'Ventilator Leak': 0
	};

	function clone(o) { return JSON.parse(JSON.stringify(o)); }

	class PhysiologyModel {

		constructor(opts) {
			opts = opts || {};
			this.patient = Object.assign({}, DEFAULT_PATIENT, opts.patient || {});
			this.ventilator = Object.assign({}, DEFAULT_VENTILATOR, opts.ventilator || {});
			this.conditions = clone(opts.conditions || {});
			this.actions = Object.assign({}, DEFAULT_ACTIONS, opts.actions || {});
			this.override = null; // sustained inflation (recruitment maneuver)
			this.reset();
		}

		/*
		 * Reset dynamic state and let the patient reach steady state
		 */
		reset() {
			this.t = 0;
			this.S = {
				open: 0.5,      // fraction of recruitable lung that is open at end-expiration
				symp: 0,        // sympathetic tone (baroreflex / chemoreflex)
				hr: this.patient.HeartRateBaseline,
				paco2: 40,
				spo2: 0.97,
				lactate: 1.0,
				fluid: 0,       // mL of intravascular volume added (+) or lost (-)
				infusion: 0,    // mL still to be infused
				infusionRate: 0,// mL/s
				hbDil: 1,
				rvFunc: 1       // right ventricular function (RV-PA coupling), smoothed
			};
			this.prev = { pplat: 20, pao2: 90, pvo2: 40, paco2: 40, ph: 7.4, mpap: 16, overdist: 0 };
			this.settle(900);
			this.t = 0;
		}

		settle(seconds) {
			const savedOverride = this.override;
			this.override = null;
			for (let i = 0; i < seconds; i++) this.step(1);
			this.override = savedOverride;
		}

		/* ---------------------------------------------------------------- inputs */

		setVentilator(params) { Object.assign(this.ventilator, params); }
		setPatient(params) { Object.assign(this.patient, params); }
		setAction(name, value) { this.actions[name] = value; }
		setCondition(name, params) {
			if (params) this.conditions[name] = Object.assign({}, params);
			else delete this.conditions[name];
		}

		fluidBolus(mL, seconds) {
			this.S.infusion += mL;
			this.S.infusionRate = mL / (seconds || 300);
		}
		hemorrhage(mL) { this.S.fluid -= mL; }

		startSustainedInflation(pressure, duration) {
			this.override = { type: 'SI', pressure: pressure, remaining: duration, duration: duration };
		}
		stopOverride() { this.override = null; }

		/* ----------------------------------------------------- derived constants */

		derive() {
			const P = this.patient, C = this.conditions, A = this.actions;
			const hIn = P.Height / 2.54;
			const pbw = Math.max(30, (P.Sex === 'F' ? 45.5 : 50) + 2.3 * (hIn - 60));
			const bmi = P.Weight / Math.pow(P.Height / 100, 2);
			const bsa = Math.sqrt(P.Height * P.Weight / 3600);
			const ards = C['ARDS'] ? avg(C['ARDS'].LeftLungSeverity, C['ARDS'].RightLungSeverity) : 0;
			const pneu = C['Pneumonia'] ? avg(C['Pneumonia'].LeftLungSeverity, C['Pneumonia'].RightLungSeverity) : 0;
			const copdB = C['COPD'] ? (C['COPD'].BronchitisSeverity || 0) : 0;
			const copdE = C['COPD'] ? avg(C['COPD'].LeftLungEmphysemaSeverity, C['COPD'].RightLungEmphysemaSeverity) : 0;
			const fib = C['Pulmonary Fibrosis'] ? (C['Pulmonary Fibrosis'].Severity || 0) : 0;
			const shuntSev = C['Pulmonary Shunt'] ? (C['Pulmonary Shunt'].Severity || 0) : 0;
			const anemia = C['Chronic Anemia'] ? (C['Chronic Anemia'].ReductionFactor || 0) : 0;
			const effusion = C['Pericardial Effusion'] ? (C['Pericardial Effusion'].AccumulatedVolume || 0) : 0;
			const lvdC = C['Chronic Ventricular Systolic Disfunction'];
			const lvd = lvdC ? (lvdC.Severity === undefined ? 0.6 : lvdC.Severity) : 0;
			const obes = clamp((bmi - 25) / 15, 0, 1.5);
			const co0 = 3.0 * bsa;
			const map0 = (P.SystolicArterialPressureBaseline + 2 * P.DiastolicArterialPressureBaseline) / 3;
			const vo2 = P.BasalMetabolicRate / 1440 / 4.83 * 1000;
			const hb0 = (P.Sex === 'F' ? 13.2 : 14.8) * (1 - anemia);
			const bv = 70 * P.Weight;
			return { pbw, bmi, bsa, ards, pneu, copdB, copdE, fib, shuntSev, anemia, effusion, lvd, obes,
				co0, map0, vo2, hb0, bv, A };
		}

		/* ------------------------------------------------ respiratory mechanics */

		mechanics(d, v) {
			const S = this.S, A = d.A, P = this.patient;
			const m = {};

			//Lung structure: consolidated (not recruitable) and recruitable fractions
			m.consolidated = clamp(0.2 * d.ards + 0.35 * d.pneu, 0, 0.6);
			m.recruitable = clamp(0.03 + 0.45 * d.ards + 0.15 * d.pneu + 0.08 * d.obes, 0, 0.9 - m.consolidated);
			//Opening / closing pressure distributions (superimposed pressure raises both)
			m.pOpen = 16 + 12 * d.ards + 4 * d.pneu + 5 * d.obes;
			m.pClose = 5 + 8 * d.ards + 2 * d.pneu + 4 * d.obes;
			m.sdOpen = 5; m.sdClose = 3.5;

			m.raw = 9 * (1 + 2.5 * d.copdB + 0.8 * d.copdE + 3 * A['Bronchoconstriction']) + 30 * A['Airway Obstruction'];
			m.ccw = 180 / (1 + 0.8 * d.obes);

			const pInspPrev = this.override ? this.override.pressure : this.prev.pplat;
			m.openInsp = phi((pInspPrev - m.pOpen) / m.sdOpen);
			const openCycleMax = Math.max(S.open, m.openInsp);
			m.aerExp = 1 - m.consolidated - m.recruitable * (1 - S.open);
			m.aerInsp = 1 - m.consolidated - m.recruitable * (1 - openCycleMax);
			m.tidalRecruit = m.recruitable * (openCycleMax - S.open);

			//Aerated ("baby") lung pressure-volume curve (Salazar-Knowles) + linear chest wall
			const vmaxSpec = 42 * (1 + 0.35 * d.copdE) * (1 - 0.45 * d.fib);
			const clSpec = 1.5 * (1 + 0.9 * d.copdE) * (1 - 0.6 * d.fib) * (1 - 0.3 * d.ards);
			const aerPV = 0.5 * (m.aerExp + m.aerInsp);
			const vmax = Math.max(200, vmaxSpec * d.pbw * aerPV);
			const k = clSpec / vmaxSpec;
			const ccw = m.ccw;
			const pawOfV = V => -Math.log(1 - Math.min(V, vmax * 0.999) / vmax) / k + V / ccw;
			const vOfPaw = p => p <= 0 ? 0 : invert(pawOfV, p, 0, vmax * 0.999, 40);
			m.vmax = vmax;

			const leak = A['Ventilator Leak'] || 0;
			const peepSet = Math.max(0, v.PositiveEndExpiratoryPressure * (1 - 0.5 * leak));
			m.peepSet = peepSet;
			m.ppl0 = 3 + 4 * d.obes; // pleural pressure at FRC, supine (cmH2O)

			if (this.override) {
				//Sustained inflation: constant airway pressure, no tidal ventilation
				const p = this.override.pressure;
				const vol = vOfPaw(p);
				Object.assign(m, {
					mode: 'SI', rr: 0, ti: 0, te: 0, ttot: 4, vt: 0, pplat: p, ppeak: p, peepTot: p, autoPeep: 0,
					vpeep: vol, vpeepSet: vol, crs: this.prev.crs || 40, tau: 0, mpaw: p, pmus: 0
				});
				m.pplMean = m.ppl0 + vol / ccw;
				m.vMeanAbove = vol; m.pmusMean = 0;
				m.pplEE = m.pplMean; m.pplEI = m.pplMean;
				m.ptp = p - m.pplMean;
				m.ptpMean = m.ptp;
				m.mp = 0;
				m.wave = { t: [0, 4], paw: [p, p], flow: [0, 0], vol: [0, 0], ttot: 4 };
			} else {
				const sedation = clamp(P.Sedation, 0, 1);
				const drive = clamp(Math.pow(this.prev.paco2 / 40, 2), 0.3, 3);
				const spontRR = P.RespirationRateBaseline * (1 - sedation) * drive;
				let rr;
				if (v.mode === 'CPAP') rr = spontRR;
				else rr = v.AssistedMode === 0 ? Math.max(v.RespirationRate, spontRR) : v.RespirationRate;
				m.spontRR = spontRR;
				m.pmus = v.mode === 'CPAP' || v.AssistedMode === 0 ? (1 - sedation) * 6 * clamp(this.prev.paco2 / 40, 0.5, 2) : 0;

				if (rr < 0.5) {
					//Apnea (e.g. CPAP in a sedated patient)
					const vol = vOfPaw(peepSet);
					Object.assign(m, { mode: v.mode, rr: 0, ti: 0, te: 0, ttot: 6, vt: 0, pplat: peepSet, ppeak: peepSet,
						peepTot: peepSet, autoPeep: 0, vpeep: vol, vpeepSet: vol, crs: this.prev.crs || 40, tau: 0, mpaw: peepSet, pmus: 0 });
					m.pplMean = m.ppl0 + vol / ccw; m.pplEE = m.pplMean; m.pplEI = m.pplMean;
					m.vMeanAbove = vol; m.pmusMean = 0;
					m.ptp = peepSet - m.pplMean; m.ptpMean = m.ptp; m.mp = 0;
					m.wave = { t: [0, 6], paw: [peepSet, peepSet], flow: [0, 0], vol: [0, 0], ttot: 6 };
				} else {
					const ttot = 60 / rr;
					let ti = v.mode === 'CPAP' ? Math.min(1.0, 0.4 * ttot) : Math.min(v.InspiratoryPeriod, 0.8 * ttot);
					ti = Math.max(0.2, ti);
					const te = ttot - ti;
					const vpeepSet = vOfPaw(peepSet);

					let peepi = 0, vt = 0, pplat = peepSet, crs = this.prev.crs || 50, ppeak = peepSet, vpeep = vpeepSet;
					let vstatLast = 0, teffLast = ti, xLast = 0, vtrapLast = 0;
					for (let it = 0; it < 8; it++) {
						const peepTot = peepSet + peepi;
						vpeep = vOfPaw(peepTot);
						const tau = m.raw * crs / 1000;
						if (v.mode === 'VC') {
							const flowLs = v.Flow / 60;
							vt = Math.min(v.TidalVolume * (1 - 0.6 * leak), flowLs * 1000 * ti);
							pplat = pawOfV(vpeep + vt);
							ppeak = pplat + m.raw * flowLs;
						} else if (v.mode === 'PC') {
							const pip = Math.max(v.InspiratoryPressure, peepSet + 1);
							const vstat = Math.max(0, vOfPaw(pip) - vpeep);
							const teff = Math.max(0.05, ti - 0.5 * v.Slope);
							vt = vstat * (1 - Math.exp(-teff / Math.max(tau, 0.05))) * (1 - 0.3 * leak);
							vstatLast = vstat; teffLast = teff;
							pplat = pawOfV(vpeep + vt);
							ppeak = pip;
						} else {
							const drivingP = v.DeltaPressureSupport + m.pmus;
							const vstat = Math.max(0, vOfPaw(peepTot + drivingP) - vpeep);
							vt = vstat * (1 - Math.exp(-ti / Math.max(tau, 0.05))) * (1 - 0.3 * leak);
							vstatLast = vstat; teffLast = ti;
							pplat = pawOfV(vpeep + vt);
							ppeak = peepSet + v.DeltaPressureSupport;
						}
						crs = vt > 1 ? vt / Math.max(0.5, pplat - peepTot) : crs;
						const tauN = m.raw * crs / 1000;
						const x = Math.exp(-te / Math.max(tauN, 0.01));
						const vtrap = vt * x / (1 - x);
						peepi = 0.5 * peepi + 0.5 * (vtrap / crs);
						xLast = x; vtrapLast = vtrap;
					}
					const tau = m.raw * crs / 1000;
					Object.assign(m, { mode: v.mode, rr, ti, te, ttot, vt, pplat, ppeak, crs, tau, vpeep, vpeepSet,
						autoPeep: peepi, peepTot: peepSet + peepi,
						vstat: vstatLast, teff: teffLast, expTe: xLast, vtrap: vtrapLast, leak, flowLs: v.Flow / 60 });

					//One breath with a linear RC model around the operating point: waveforms, means, power
					const n = 160, dtw = ttot / n;
					const tA = [], pawA = [], flowA = [], volA = [];
					let vrel = peepi * crs; // volume above the set-PEEP EELV (trapped volume at start)
					let sumPaw = 0, sumV = 0, sumPmus = 0, work = 0;
					const flowLsVC = v.Flow / 60;
					for (let i = 0; i <= n; i++) {
						const t = i * dtw;
						let paw, flow, pm = 0;
						const palv = peepSet + vrel / crs;
						if (t < ti) {
							if (v.mode === 'VC') {
								const delivered = vrel - peepi * crs;
								flow = delivered < vt ? flowLsVC * 1000 : 0; // mL/s
								paw = palv + m.raw * flow / 1000;
							} else {
								const top = v.mode === 'PC' ? Math.max(v.InspiratoryPressure, peepSet + 1) : peepSet + v.DeltaPressureSupport;
								const slope = Math.max(0.01, v.Slope);
								paw = peepSet + (top - peepSet) * Math.min(1, t / slope);
								if (v.mode === 'CPAP') pm = m.pmus * Math.sin(Math.PI * t / ti);
								const vtarget = (paw + pm - peepSet) * crs;
								const dv = (vtarget - vrel) * (1 - Math.exp(-dtw / Math.max(tau, 0.02)));
								flow = dv / dtw;
							}
						} else {
							paw = peepSet;
							const dv = (0 - vrel) * (1 - Math.exp(-dtw / Math.max(tau, 0.02)));
							flow = dv / dtw;
						}
						tA.push(t); pawA.push(paw); flowA.push(flow * 60 / 1000); volA.push(vrel);
						if (i < n) {
							sumPaw += paw; sumV += vrel; sumPmus += pm;
							if (flow > 0) work += paw * flow * dtw; // cmH2O * mL
							vrel += flow * dtw;
						}
					}
					m.wave = { t: tA, paw: pawA, flow: flowA, vol: volA, ttot };
					m.mpaw = sumPaw / n;
					const vmean = sumV / n;
					m.pplMean = m.ppl0 + (vpeepSet + vmean) / ccw - sumPmus / n;
					m.vMeanAbove = vpeepSet + vmean; m.pmusMean = sumPmus / n;
					m.pplEE = m.ppl0 + (vpeepSet + peepi * crs) / ccw;
					m.pplEI = m.pplEE + vt / ccw - m.pmus;
					m.ptp = pplat - (m.ppl0 + (vpeep + vt) / ccw);
					m.ptpMean = m.mpaw - m.pplMean;
					m.mp = work * 0.098 / 1000 * rr; // J/min
				}
			}

			//Aerated FRC (supine, ZEEP) and global strain as defined by Chiumello (VT + V_PEEP) / FRC
			m.frc = 25 * d.pbw * m.aerExp * (1 + 0.4 * d.copdE);
			m.eelv = m.frc + m.vpeep;
			m.strain = (m.vt + m.vpeep) / m.frc;
			m.fillInsp = (m.vpeep + m.vt) / vmax;
			m.overdist = clamp((m.fillInsp - 0.55) / 0.35, 0, 1);
			m.dp = m.pplat - m.peepTot;
			return m;
		}

		/* ------------------------------------------------------- hemodynamics */

		hemodynamics(d, m) {
			const S = this.S, prev = this.prev, P = this.patient;
			const h = {};
			const volemia = P.Volemia + S.fluid / d.bv;
			h.volemia = volemia;
			const ppl0mm = m.ppl0 * CMH2O_TO_MMHG;
			const pplMean = m.pplMean * CMH2O_TO_MMHG;
			h.pplMean = pplMean;
			//Pericardial pressure (exponential pericardial P-V curve)
			h.ppc = d.effusion > 100 ? 2 * (Math.exp((d.effusion - 100) / 300) - 1) : 0;

			//Mean systemic filling pressure: stressed volume, venoconstriction, abdominal transmission of PEEP
			h.pmsf = Math.max(2, 12 + (volemia - 1) * d.bv / (2.8 * P.Weight) + 3 * d.lvd + 3.5 * S.symp
				+ 0.3 * Math.max(0, pplMean - ppl0mm));
			const rvr = 7.4 / d.co0;
			h.rvr = rvr;

			//Cardiac function curve calibrated on the reference (spontaneously breathing, healthy) patient
			const kp = 3.5 * (1 + 1.2 * d.lvd);
			const rapRef = 12 - d.co0 * rvr;
			const comax0 = d.co0 / (1 - Math.exp(-(rapRef - 2.2) / 3.5));
			const hrFactor = Math.pow(clamp(S.hr / P.HeartRateBaseline, 0.4, 2.5), 0.5);
			const contract = (1 - 0.5 * d.lvd) * (1 + 0.25 * S.symp);
			h.rvFunc = S.rvFunc;
			h.lvUnload = 1 + d.lvd * 0.05 * Math.max(0, pplMean);
			const comax = comax0 * hrFactor * contract * h.rvFunc * h.lvUnload;
			Object.assign(h, { kp, comax, comax0, hrFactor, contract, rapRef });

			const solve = pplX => {
				const cardiac = rap => comax * (1 - Math.exp(-Math.max(0, rap - pplX - h.ppc) / kp));
				const f = rap => (h.pmsf - Math.max(rap, 0)) / rvr - cardiac(rap);
				let lo = -10, hi = h.pmsf;
				for (let i = 0; i < 50; i++) {
					const mid = (lo + hi) / 2;
					if (f(mid) > 0) lo = mid; else hi = mid;
				}
				const rap = (lo + hi) / 2;
				return { rap, co: Math.max(0.2, cardiac(rap)), slope: comax / kp * Math.exp(-Math.max(0, rap - pplX - h.ppc) / kp) };
			};
			const mean = solve(pplMean);
			h.rap = mean.rap; h.co = mean.co;
			h.vrGradient = h.pmsf - Math.max(h.rap, 0);
			h.preloadSlope = mean.slope;

			//Pulse pressure variation: tidal swing of pleural pressure times the slope of the Starling curve
			//at the operating point (preload dependence), relative to cardiac output
			if (m.rr > 0) {
				const swing = Math.abs(m.pplEE - m.pplEI) * CMH2O_TO_MMHG;
				h.ppv = clamp(2 + 10 * swing * mean.slope / h.co, 0, 45);
				h.swing = swing;
			} else h.ppv = 2;

			h.pawp = pplMean + (h.rap - pplMean - h.ppc) * 1.1 + 2 + 12 * d.lvd + h.ppc;

			//Pulmonary vascular resistance: U-shaped with lung volume, HPV, acidosis, disease
			const nonAerExp = 1 - m.aerExp;
			const lowVol = 1 + 1.2 * Math.max(0, nonAerExp - 0.05);
			const highVol = 1 + 3 * Math.pow(m.overdist, 1.5) + 0.03 * Math.max(0, m.ptpMean - 8);
			const hpv = 1 + 0.5 * clamp((40 - prev.pvo2) / 15, 0, 1) + 0.6 * clamp((70 - prev.pao2) / 30, 0, 1);
			const acid = 1 + 1.5 * clamp(7.38 - prev.ph, 0, 0.4);
			const disease = 1 + 0.7 * d.ards + 0.8 * d.fib + 0.3 * d.copdE;
			h.pvr = 1.6 * (5.9 / d.co0) * lowVol * highVol * hpv * acid * disease;
			Object.assign(h, { pvr0: 1.6 * (5.9 / d.co0), pvrLow: lowVol, pvrHigh: highVol, pvrHpv: hpv, pvrAcid: acid, pvrDisease: disease });
			//West zones (vascular waterfall). Along the supine lung height (~19 cm = 14 mmHg of hydrostatic
			//gradient, left atrium at mid height) the capillary outflow pressure is the higher of local venous
			//and alveolar pressure; averaged over the height, the effective downstream pressure is PAWP plus an
			//excess that is 0 while the whole lung is in zone 3 and grows as zone 2 spreads.
			const H = 14;
			const palv = m.mpaw * CMH2O_TO_MMHG;
			const D = palv - h.pawp;
			h.palv = palv;
			h.zone12 = clamp((D + H / 2) / H, 0, 1);
			h.waterfall = D <= -H / 2 ? 0 : D >= H / 2 ? D : Math.pow(D + H / 2, 2) / (2 * H);
			h.pOut = h.pawp + h.waterfall;
			h.mpap = h.pOut + h.co * h.pvr;

			//Systemic circulation
			const svr0 = (d.map0 - rapRef) / d.co0;
			h.svrAcid = 1 - 0.8 * clamp(7.3 - prev.ph, 0, 0.3);
			h.svr0 = svr0;
			h.svr = svr0 * (1 + 0.4 * S.symp) * h.svrAcid;
			h.map = h.co * h.svr + h.rap;
			h.hr = S.hr;
			h.sv = h.co / S.hr * 1000;
			const sv0 = d.co0 / P.HeartRateBaseline * 1000;
			const cart = sv0 / (P.SystolicArterialPressureBaseline - P.DiastolicArterialPressureBaseline);
			const pp = h.sv / cart;
			h.sbp = h.map + 2 * pp / 3;
			h.dbp = h.map - pp / 3;
			h.lvTransmural = h.sbp - pplMean;
			return h;
		}

		/* ------------------------------------------------------- gas exchange */

		gasExchange(d, m, h, v) {
			const S = this.S, prev = this.prev, A = d.A;
			const g = {};
			const fio2 = clamp(v.FractionInspiredOxygen, 0.21, 1);
			const paco2 = S.paco2;
			const pio2 = fio2 * (P_ATM - P_H2O);
			g.pAO2 = Math.max(0, pio2 - paco2 * (fio2 + (1 - fio2) / 0.8));

			const nonAerMean = m.mode === 'SI' ? 1 - m.aerExp : 1 - 0.6 * m.aerExp - 0.4 * m.aerInsp;
			g.shunt = clamp(0.02 + nonAerMean * 0.55 * Math.pow(h.co / d.co0, 0.35) + 0.35 * d.shuntSev
				+ 0.15 * m.overdist * nonAerMean, 0.02, 0.75);
			g.lowVQ = clamp(0.03 + 0.25 * d.copdB + 0.2 * d.copdE + 0.15 * d.pneu + 0.1 * d.ards
				+ 0.25 * A['Bronchoconstriction'], 0, 0.5);
			g.hb = d.hb0 * S.hbDil;
			g.vo2 = d.vo2 * (1 + 0.12 * Math.max(0, S.symp)) + 25 * (1 - clamp(this.patient.Sedation, 0, 1));

			let pvo2 = prev.pvo2, ca = 18, cv = 13, vo2eff = g.vo2;
			const cc = o2Content(g.pAO2, g.hb);
			for (let i = 0; i < 6; i++) {
				const plow = pvo2 + (g.pAO2 - pvo2) * (0.3 + 0.55 * fio2);
				const clow = o2Content(plow, g.hb);
				g.plow = plow; g.clow = clow;
				const avd = g.vo2 / (10 * h.co);
				ca = ((1 - g.shunt - g.lowVQ) * cc + g.lowVQ * clow - g.shunt * avd) / (1 - g.shunt);
				cv = ca - avd;
				if (cv < 0.2 * ca) { // supply dependency: extraction cannot exceed ~80%
					const cmix = (1 - g.shunt - g.lowVQ) * cc + g.lowVQ * clow;
					ca = cmix / (1 - 0.2 * g.shunt); // ca = (1-s-q)cc + q*clow + s*0.2*ca
					cv = 0.2 * ca;
				}
				vo2eff = (ca - cv) * 10 * h.co;
				pvo2 = po2FromContent(cv, g.hb);
			}
			g.cao2 = ca; g.cvo2 = cv; g.pvo2 = pvo2; g.vo2eff = vo2eff; g.cc = cc;
			g.nonAerMean = nonAerMean;
			g.pao2 = po2FromContent(ca, g.hb);
			g.sao2 = satFromPO2(g.pao2);
			g.svo2 = satFromPO2(pvo2);
			g.do2 = h.co * ca * 10;
			g.o2er = vo2eff / g.do2;
			g.fio2 = fio2;

			//Dead space and alveolar ventilation
			g.vdAnat = 2.2 * d.pbw;
			const zone1 = 0.15 * clamp((m.mpaw * CMH2O_TO_MMHG - h.pawp) / 15, 0, 1);
			g.zone1 = zone1;
			g.vdAlvFrac = clamp(0.05 + 0.3 * m.overdist + 0.25 * d.ards + 0.25 * d.copdE
				+ 0.25 * clamp(1 - h.co / d.co0, 0, 1) + zone1, 0, 0.8);
			const vtAlv = Math.max(0, m.vt - g.vdAnat);
			g.va = m.rr * vtAlv * (1 - g.vdAlvFrac) / 1000;
			g.ve = m.rr * m.vt / 1000;
			g.vdvt = m.vt > 0 ? clamp(1 - g.va * 1000 / (m.rr * m.vt), 0, 1) : 1;
			g.vco2 = 0.8 * g.vo2;
			g.etco2 = m.rr > 0 ? paco2 * (1 - g.vdAlvFrac) * (1 - 0.1 * g.shunt) : 0;
			return g;
		}

		/* ------------------------------------------------------------- step */

		step(dt) {
			const S = this.S, P = this.patient;
			const d = this.derive();
			const v = this.ventilator;

			if (this.override) {
				this.override.remaining -= dt;
				if (this.override.remaining <= 0) this.override = null;
			}

			//Fluids
			if (S.infusion > 0) {
				const dv = Math.min(S.infusion, S.infusionRate * dt);
				S.infusion -= dv;
				S.fluid += 0.6 * dv; // intravascular fraction of the bolus
			}
			S.hbDil = d.bv / (d.bv + Math.max(0, S.fluid));

			const m = this.mechanics(d, v);

			//Recruitment / derecruitment with hysteresis
			const duty = m.mode === 'SI' ? 1 : (m.ttot > 0 && m.rr > 0 ? m.ti / m.ttot : 0);
			const openInsp = phi((m.pplat - m.pOpen) / m.sdOpen);
			const keep = phi((m.peepTot - m.pClose) / m.sdClose);
			const rise = Math.min(openInsp, keep);
			if (S.open < rise && duty > 0) S.open = relax(S.open, rise, dt, 5 / duty);
			else if (S.open > keep) S.open = relax(S.open, keep, dt, 40);

			const h = this.hemodynamics(d, m);
			const g = this.gasExchange(d, m, h, v);

			//Reflex control (baroreflex + chemoreflex + stress)
			const e = (d.map0 - h.map) / d.map0;
			const chemo = 0.6 * clamp((65 - g.pao2) / 30, 0, 1) + 0.4 * clamp((S.paco2 - 50) / 30, 0, 1);
			const sympTarget = clamp(5 * e + chemo + (d.A['Acute Stress'] || 0), -0.6, 1.8);
			S.symp = relax(S.symp, sympTarget, dt, 10);
			const hrTarget = clamp(P.HeartRateBaseline * (1 + 0.5 * S.symp), 35, 180);

			//Right ventricle - pulmonary artery coupling. RV afterload is the effective arterial elastance
			//Ea = transmural mPAP / stroke volume (indexed): unlike mPAP it does not fall when flow falls, and
			//pleural pressure, which surrounds both RV and pulmonary artery, is not a load. RV function stays
			//full while Ees/Ea is comfortably above 1 and falls as coupling approaches uncoupling.
			const eaI = Math.max(0.05, h.mpap - h.pplMean) / Math.max(5, h.sv / d.bsa);
			const eesI = EES_RV_INDEXED;
			const coupling = eesI / eaI;
			const rvTarget = coupling >= 1.2 ? 1 : Math.max(0.5, 1 / (1 + Math.pow(1.2 - coupling, 2)));
			S.rvFunc = relax(S.rvFunc, rvTarget, dt, 4);
			S.hr = relax(S.hr, hrTarget, dt, 5);

			//CO2 stores
			const elim = g.va * S.paco2 / 0.863; // mL/min
			S.paco2 = clamp(S.paco2 + (g.vco2 - elim) / 25 * dt / 60, 10, 150);

			//Pulse oximeter lag
			S.spo2 = relax(S.spo2, g.sao2, dt, 8);

			//Lactate (oxygen debt)
			const lacTarget = 1 + 18 * Math.max(0, g.o2er - 0.45) + 0.08 * Math.max(0, 60 - h.map);
			S.lactate = relax(S.lactate, lacTarget, dt, 240);
			const hco3 = 24 - (S.lactate - 1) + 0.1 * (S.paco2 - 40);
			const ph = 6.1 + Math.log10(hco3 / (0.03 * S.paco2));

			const prevUsed = { mpap: this.prev.mpap, ph: this.prev.ph, pao2: this.prev.pao2, pvo2: this.prev.pvo2 };
			this.t += dt;
			this.prev = { pplat: m.pplat, pao2: g.pao2, pvo2: g.pvo2, paco2: S.paco2, ph, mpap: h.mpap, crs: m.crs, overdist: m.overdist };

			const out = {
				t: this.t,
				mode: m.mode,
				override: this.override ? Object.assign({}, this.override) : null,
				//ventilator & patient inputs
				peepSet: v.PositiveEndExpiratoryPressure,
				vtSet: v.TidalVolume, pinsp: v.InspiratoryPressure, ps: v.DeltaPressureSupport,
				rrSet: v.RespirationRate, rr: m.rr, ti: m.ti, te: m.te, ie: m.te > 0 ? m.ti / m.te : 0,
				fio2: g.fio2, raw: m.raw, ccw: m.ccw, volemia: h.volemia * 100, contract: (1 - 0.5 * d.lvd) * 100,
				sedation: P.Sedation, pbw: d.pbw, bmi: d.bmi, bsa: d.bsa,
				//mechanics
				autoPeep: m.autoPeep, peepTot: m.peepTot, aeration: m.aerExp * 100, openFrac: S.open,
				tidalRecruit: m.tidalRecruit * 100, recruitable: m.recruitable * 100, consolidated: m.consolidated * 100,
				overdist: m.overdist * 100, crs: m.crs, pplat: m.pplat, ppeak: m.ppeak, dp: m.dp, mpaw: m.mpaw,
				eelv: m.eelv, strain: m.strain, mp: m.mp, vt: m.vt, vtKg: m.vt / d.pbw, tau: m.tau,
				pplMean: m.pplMean, pplEE: m.pplEE, pplEI: m.pplEI, ptp: m.ptp, pOpen: m.pOpen, pClose: m.pClose,
				//gas exchange
				shunt: g.shunt * 100, lowVQ: g.lowVQ * 100, vdvt: g.vdvt * 100, va: g.va, ve: g.ve,
				paco2: S.paco2, etco2: g.etco2, pAO2: g.pAO2, pao2: g.pao2, pf: g.pao2 / g.fio2,
				spo2: S.spo2 * 100, sao2: g.sao2 * 100,
				//hemodynamics
				pmsf: h.pmsf, rap: h.rap, vrGradient: h.vrGradient, pvr: h.pvr, pvrDyn: h.pvr * 80, mpap: h.mpap,
				pawp: h.pawp, rvFunc: h.rvFunc * 100, lvTransmural: h.lvTransmural, co: h.co, ci: h.co / d.bsa,
				sv: h.sv, hr: S.hr, symp: S.symp * 100, svr: h.svr, svrDyn: h.svr * 80, map: h.map,
				sbp: h.sbp, dbp: h.dbp, ppv: h.ppv, ppc: h.ppc, pplMeanMmHg: h.pplMean,
				//oxygen transport & metabolism
				hb: g.hb, cao2: g.cao2, cvo2: g.cvo2, do2: g.do2, do2i: g.do2 / d.bsa, vo2: g.vo2eff,
				svo2: g.svo2 * 100, o2er: g.o2er * 100, lactate: S.lactate, ph: ph, hco3: hco3,
				wave: m.wave,
				//intermediate quantities, shown by the live equations view
				x: {
					ards: d.ards, pneu: d.pneu, copdB: d.copdB, copdE: d.copdE, fib: d.fib, shuntSev: d.shuntSev, anemia: d.anemia,
					effusion: d.effusion, lvd: d.lvd, obes: d.obes, co0: d.co0, map0: d.map0, vo2Basal: d.vo2, hb0: d.hb0, bv: d.bv,
					weight: P.Weight, hrBase: P.HeartRateBaseline, rrBase: P.RespirationRateBaseline, volemiaSet: P.Volemia,
					bronch: d.A['Bronchoconstriction'] || 0, obstr: d.A['Airway Obstruction'] || 0, stress: d.A['Acute Stress'] || 0,
					leak: d.A['Ventilator Leak'] || 0, fluid: S.fluid, hbDil: S.hbDil,
					peepE: m.peepSet, ttot: m.ttot, spontRR: m.spontRR || 0, pmus: m.pmus || 0, flowLs: m.flowLs || 0,
					vstat: m.vstat || 0, teff: m.teff || 0, expTe: m.expTe || 0, vtrap: m.vtrap || 0,
					consolidated: m.consolidated, recruitable: m.recruitable, open: S.open, openInsp: openInsp, keep: keep,
					pOpen: m.pOpen, pClose: m.pClose, aerExp: m.aerExp, aerInsp: m.aerInsp,
					vpeep: m.vpeep, vmax: m.vmax, fillInsp: m.fillInsp, frc: m.frc, ppl0: m.ppl0, vMeanAbove: m.vMeanAbove,
					pmusMean: m.pmusMean || 0, pplPlat: m.ppl0 + (m.vpeep + m.vt) / m.ccw,
					nonAerMean: g.nonAerMean, lowVQ: g.lowVQ, cc: g.cc, clow: g.clow, plow: g.plow, pvo2: g.pvo2,
					avd: g.vo2 / (10 * h.co), vo2Demand: g.vo2, vco2: g.vco2, vdAnat: g.vdAnat, vdAlv: g.vdAlvFrac, zone1: g.zone1,
					pio2: g.fio2 * (P_ATM - P_H2O), elim, dPaco2PerMin: (g.vco2 - elim) / 25,
					rvr: h.rvr, kp: h.kp, comax: h.comax, hrFactor: h.hrFactor, contractF: h.contract, lvUnload: h.lvUnload,
					ptm: h.rap - h.pplMean - h.ppc, slope: h.preloadSlope, swing: h.swing || 0,
					pvrWU: h.pvr, pvr0: h.pvr0, pvrLow: h.pvrLow, pvrHigh: h.pvrHigh, pvrHpv: h.pvrHpv, pvrAcid: h.pvrAcid, pvrDisease: h.pvrDisease,
					svrWU: h.svr, svr0: h.svr0, svrAcid: h.svrAcid, sympTarget, chemo, baroError: e,
					eaRV: eaI, eesRV: eesI, rvCoupling: coupling, rvTarget, mpapTm: h.mpap - h.pplMean,
					palv: h.palv, zone12: h.zone12, waterfall: h.waterfall, pOut: h.pOut, hydroSpan: 14, lapTm: h.pawp - h.pplMean,
					lacTarget, prevMpap: prevUsed.mpap, prevPh: prevUsed.ph, prevPao2: prevUsed.pao2, prevPvo2: prevUsed.pvo2
				}
			};
			this.out = out;
			return out;
		}
	}

	const api = { PhysiologyModel, DEFAULT_PATIENT, DEFAULT_VENTILATOR, DEFAULT_ACTIONS, satFromPO2, o2Content,
		po2FromContent, CMH2O_TO_MMHG };
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
	else global.BreathePhysiology = api;
})(typeof window !== 'undefined' ? window : globalThis);
