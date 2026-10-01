import java.util.*;
import com.kitware.pulse.utilities.JNIBridge;
import com.kitware.pulse.engine.PulseEngine;
import com.kitware.pulse.cdm.engine.SEDataRequestManager;
import com.kitware.pulse.cdm.properties.CommonUnits.*;
import com.kitware.pulse.cdm.properties.SEScalarTime;
import com.kitware.pulse.cdm.bind.Enums.eSwitch;
import com.kitware.pulse.cdm.bind.Physiology.eLungCompartment;
import com.kitware.pulse.cdm.bind.MechanicalVentilatorActions.MechanicalVentilatorVolumeControlData;
import com.kitware.pulse.cdm.patient.actions.*;
import com.kitware.pulse.cdm.system.equipment.mechanical_ventilator.actions.SEMechanicalVentilatorVolumeControl;

/*
 * PEEP ladder in Pulse, same protocol as NodeSim's literature check:
 * StandardMale, no spontaneous breathing (dyspnea 1), VC-CMV VT 450 mL, RR 18, Ti 0.9 s,
 * flow 50 L/min, FiO2 0.6; PEEP 0 -> 5 -> 10 -> 15 -> 20, values averaged over the last 30 s.
 * args: ardsSeverity (0 = healthy) stabilizeSeconds stepSeconds
 * Run it from BREATHE's breathe.engine folder (native library libPulseJNI.so and states/),
 * with breathe.engine/jar/* on the classpath: see run.sh. Prints a tab-separated table.
 */
public class PeepLadder {
	static final String[] NAMES = { "CO", "MAP", "HR", "CVP", "mPAP", "Ppl", "PaO2", "PaCO2", "Shunt", "SaO2", "Pplat", "Ppeak", "Cstat", "PEEPtot", "VT" };

	public static void main(String[] args) throws Exception {
		double ards = Double.parseDouble(args[0]);
		int stab = Integer.parseInt(args[1]), step = Integer.parseInt(args[2]);
		JNIBridge.initialize("./");
		PulseEngine pe = new PulseEngine();
		SEDataRequestManager dr = new SEDataRequestManager();
		dr.createPhysiologyDataRequest("CardiacOutput", VolumePerTimeUnit.L_Per_min);
		dr.createPhysiologyDataRequest("MeanArterialPressure", PressureUnit.mmHg);
		dr.createPhysiologyDataRequest("HeartRate", FrequencyUnit.Per_min);
		dr.createPhysiologyDataRequest("MeanCentralVenousPressure", PressureUnit.mmHg);
		dr.createPhysiologyDataRequest("PulmonaryMeanArterialPressure", PressureUnit.mmHg);
		dr.createPhysiologyDataRequest("IntrapleuralPressure", PressureUnit.cmH2O);
		dr.createPhysiologyDataRequest("ArterialOxygenPressure", PressureUnit.mmHg);
		dr.createPhysiologyDataRequest("ArterialCarbonDioxidePressure", PressureUnit.mmHg);
		dr.createPhysiologyDataRequest("ShuntFraction");
		dr.createPhysiologyDataRequest("OxygenSaturation");
		dr.createMechanicalVentilatorDataRequest("PlateauPressure", PressureUnit.cmH2O);
		dr.createMechanicalVentilatorDataRequest("PeakInspiratoryPressure", PressureUnit.cmH2O);
		dr.createMechanicalVentilatorDataRequest("StaticRespiratoryCompliance", VolumePerPressureUnit.mL_Per_cmH2O);
		dr.createMechanicalVentilatorDataRequest("TotalPositiveEndExpiratoryPressure", PressureUnit.cmH2O);
		dr.createMechanicalVentilatorDataRequest("TidalVolume", VolumeUnit.mL);
		if (!pe.serializeFromFile("./states/StandardMale@0s.json", dr)) throw new RuntimeException("state not loaded");

		SEDyspnea dys = new SEDyspnea();
		dys.getRespirationRateSeverity().setValue(1.0);
		dys.getTidalVolumeSeverity().setValue(1.0);
		pe.processAction(dys);
		SEMechanicalVentilatorVolumeControl vc = new SEMechanicalVentilatorVolumeControl();
		vc.setConnection(eSwitch.On);
		vc.setMode(MechanicalVentilatorVolumeControlData.eMode.ContinuousMandatoryVentilation);
		vc.getFlow().setValue(50, VolumePerTimeUnit.L_Per_min);
		vc.getFractionInspiredOxygen().setValue(0.6);
		vc.getInspiratoryPeriod().setValue(0.9, TimeUnit.s);
		vc.getPositiveEndExpiratoryPressure().setValue(0, PressureUnit.cmH2O);
		vc.getRespirationRate().setValue(18, FrequencyUnit.Per_min);
		vc.getTidalVolume().setValue(450, VolumeUnit.mL);
		pe.processAction(vc);
		if (ards > 0) {
			SEAcuteRespiratoryDistressSyndromeExacerbation a = new SEAcuteRespiratoryDistressSyndromeExacerbation();
			a.getSeverity(eLungCompartment.LeftLung).setValue(ards);
			a.getSeverity(eLungCompartment.RightLung).setValue(ards);
			pe.processAction(a);
		}
		long t0 = System.currentTimeMillis();
		run(pe, stab, false);
		System.out.println("# stabilizzazione " + stab + " s simulati in " + (System.currentTimeMillis() - t0) / 1000 + " s reali");
		System.out.println("PEEP\t" + String.join("\t", NAMES));
		for (int peep : new int[] { 0, 5, 10, 15, 20 }) {
			vc.getPositiveEndExpiratoryPressure().setValue(peep, PressureUnit.cmH2O);
			pe.processAction(vc);
			double[] m = run(pe, step, true);
			StringBuilder sb = new StringBuilder().append(peep);
			for (double v : m) sb.append('\t').append(String.format(Locale.ROOT, "%.3f", v));
			System.out.println(sb);
		}
		pe.clear();
		pe.cleanUp();
	}

	// advance `seconds`, return the means of every request over the last 30 s
	static double[] run(PulseEngine pe, int seconds, boolean average) {
		SEScalarTime dt = new SEScalarTime(0.1, TimeUnit.s);
		double[] sum = new double[NAMES.length];
		int n = 0;
		int steps = seconds * 10;
		for (int i = 0; i < steps; i++) {
			if (!pe.advanceTime(dt)) throw new RuntimeException("advanceTime failed at step " + i);
			if (average && i >= steps - 300) {
				List<Double> d = pe.pullData();
				for (int k = 0; k < NAMES.length; k++) sum[k] += d.get(k + 1);
				n++;
			}
		}
		if (n > 0) for (int k = 0; k < sum.length; k++) sum[k] /= n;
		return sum;
	}
}
