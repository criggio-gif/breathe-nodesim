# Confronto con Pulse

Esegue lo stesso protocollo sul motore Pulse (attraverso `breathe.engine` di BREATHE) e sul modello di NodeSim, e mette i risultati uno accanto all'altro.

**Protocollo:** paziente `StandardMale` di BREATHE, senza respiro spontaneo (in Pulse: dispnea con gravità 1). Ventilazione VC-CMV con VT 450 mL, FR 18, Ti 0,9 s, flusso 50 L/min, FiO₂ 0,6. Prima una stabilizzazione, poi PEEP 0 → 5 → 10 → 15 → 20, per tre gravità: polmone sano, ARDS 0,6 e ARDS 0,85.

## Uso

```bash
tools/pulse-compare/run.sh /percorso/di/BREATHE/breathe.engine            # 10 min per livello, alcuni minuti
tools/pulse-compare/run.sh /percorso/di/BREATHE/breathe.engine 60 30      # prova veloce
SEVERITIES="0 0.6" tools/pulse-compare/run.sh /percorso/di/breathe.engine # solo alcune gravità
```

Serve Java 17 o superiore e Node 18 o superiore. `breathe.engine` deve contenere `jar/Pulse.jar`, la libreria nativa (`libPulseJNI.so` su Linux, `PulseJNI.dll` su Windows) e `states/StandardMale@0s.json`, tutti già presenti nel repository di BREATHE.

Lo script scrive in `out/` (escluso da git):
- `pulse_<gravità>.tsv` e `nodesim_<gravità>.tsv`, le tabelle grezze;
- `confronto.md`, le tabelle affiancate (P = Pulse, N = NodeSim) con il riassunto PEEP 0 → 20.

## File

| File | Cosa fa |
| --- | --- |
| `PeepLadder.java` | Pilota Pulse: carica lo stato, imposta dispnea, ventilatore ed eventuale ARDS (azione di riacutizzazione su entrambi i polmoni), esegue la scala di PEEP e stampa le medie dell'ultimo mezzo minuto di ogni livello |
| `nodesim_ladder.js` | La stessa scala sul modello di NodeSim (`js/physiology.js`) |
| `compare.js` | Unisce le tabelle in Markdown |
| `run.sh` | Compila, esegue tutto e scrive `out/confronto.md` |
| `RISULTATI-2026-10-01.md` | Risultati della prima esecuzione completa, come riferimento |

## Come leggere il confronto

- **Gravità ARDS:** non ha lo stesso significato nei due modelli. A gravità 0,6 Pulse parte da PaO₂ 66, NodeSim da 94. Conviene confrontare anche gravità diverse a parità di PaO₂ iniziale (per esempio Pulse 0,6 con NodeSim 0,85).
- **Nessuno dei due è il "vero":** per le direzioni attese e gli ordini di grandezza il riferimento resta la letteratura (`test/literature.test.js`).
- **Risultati del 1° ottobre 2026:**
  - In Pulse la PEEP non cambia gittata, PVC e pressione arteriosa, contro la letteratura. In NodeSim la gittata cala del 20–27% a PEEP 20.
  - In Pulse la compliance statica aumenta con la PEEP sia nel sano sia nell'ARDS. In NodeSim cala sempre. Nei pazienti reclutabili la letteratura descrive un aumento fino a una PEEP ottimale.
  - Nell'ARDS Pulse ha più CO₂, una pressione arteriosa polmonare più bassa e una risposta dell'ossigenazione alla PEEP più ampia.
