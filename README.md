# BREATHE NodeSim

Simulatore didattico a nodi delle modificazioni fisiologiche in un paziente intubato e ventilato meccanicamente.

Ogni **nodo** è un concetto di fisiologia (PEEP totale, aerazione polmonare, compliance, pressione pleurica, pressione media di riempimento sistemico, ritorno venoso, resistenze polmonari, gittata cardiaca, PA, shunt, spazio morto, PaO₂, PaCO₂, DO₂, lattato…). Le **frecce** indicano le relazioni causali con il loro segno (+ stesso verso, − verso opposto, ± relazione a U). Quando cambi un parametro, le frecce che partono dai nodi in variazione si animano e si può seguire l'effetto a cascata, per esempio:

```
PEEP ↑ → PEEP totale ↑ → pressione media vie aeree ↑ → pressione pleurica ↑ → PVC ↑ → gradiente di ritorno venoso ↓ → gittata cardiaca ↓ → PA ↓ → tono simpatico ↑ → FC ↑, RVS ↑
       → aerazione ↑ (se il polmone è reclutabile) → compliance ↑, shunt ↓ → PaO₂ ↑
       → sovradistensione ↑ (se non lo è) → spazio morto ↑, resistenze polmonari ↑ → funzione VD ↓
```

## Avvio

**Online:** https://criggio-gif.github.io/breathe-nodesim/

In locale non richiede build né server: aprire `index.html` nel browser.
(In alternativa `python3 -m http.server` nella cartella e poi `http://localhost:8000`.)

Il simulatore è nato come modulo di [BREATHE](https://github.com/GionathaPirola/BREATHE), simulatore respiratorio basato sul Pulse Physiology Engine, e ne usa gli stessi nomi di parametri per paziente, ventilatore, condizioni e azioni.

### Pubblicazione (GitHub Pages)

Il workflow `.github/workflows/pages.yml` esegue i test e pubblica il sito a ogni push su `main` (o manualmente da *Actions > NodeSim on GitHub Pages > Run workflow*). Configurazione iniziale, una sola volta: *Settings > Pages > Build and deployment > Source*: **GitHub Actions**.

Test del modello fisiologico (Node.js ≥ 14):

```bash
node test/physiology.test.js
node test/equations.test.js
```

## Cosa si può fare

- **Scenari**: ARDS moderata, polmone sano, ARDS grave con ipovolemia, BPCO riacutizzata, scompenso sistolico, obesità grave, versamento pericardico.
- **Ventilatore**: modalità VC, PC e CPAP/PS con gli stessi parametri di `breathe.engine` (`TidalVolume`, `InspiratoryPressure`, `DeltaPressureSupport`, `PositiveEndExpiratoryPressure`, `RespirationRate`, `FractionInspiredOxygen`, `InspiratoryPeriod`, `Flow`, `Slope`, `AssistedMode` AC/CMV).
- **Manovre**:
  - reclutamento con insufflazione sostenuta (CPAP 40 cmH₂O × 40 s, configurabile);
  - reclutamento a scalini in PC seguito da titolazione decrementale della PEEP (24 → 6 cmH₂O) con tabella della compliance e scelta automatica di PEEP ottimale + 2;
  - bolo di fluidi, emorragia.
- **Paziente, condizioni e azioni** con i nomi di `data.Patient`, `data.Condition` (ARDS, Pneumonia, COPD, Pulmonary Fibrosis, Pulmonary Shunt, Pericardial Effusion, Chronic Anemia, Chronic Ventricular Systolic Disfunction) e `data.Action` (Bronchoconstriction, Airway Obstruction, Acute Stress, Ventilator Leak). In più: volemia e sedazione.
- **Importazione** di un paziente da `breathe.engine/resources/patients/*.json` o da uno stato `breathe.engine/states/*.json` (sezione `InitialPatient`, come in `Patient.loadPatientData`).
- **Console del ventilatore** (`js/console.js`): curve di pressione, flusso, volume e pressione arteriosa integrate respiro per respiro su un polmone RC (flusso costante con pausa di fine inspirazione in VC, flusso decelerato in PC, trigger e ciclaggio al 25% del picco di flusso in pressione di supporto, espirazione passiva), con scale graduate, loop pressione-volume e tasto **Congela**. Valori misurati come su un ventilatore da terapia intensiva: Ppicco, Pplat, Pmedia, PEEP, VTe, VM, FR.
- **Pause inspiratoria ed espiratoria**, sul modello dei tasti "Insp. hold" ed "Exp. hold" dei ventilatori Dräger: clic per una pausa di 2 s (inspiratoria) o 3 s (espiratoria), tieni premuto per prolungarla fino a 15 s. La pausa inspiratoria misura Pplat, ΔP, compliance statica e resistenze; quella espiratoria PEEP totale, auto-PEEP e volume intrappolato. `test/console.test.js` verifica che le misure coincidano con il modello.
- **Solo console**: la vista nasconde i nodi e ingrandisce la console, con loop P-V e risultati delle pause.
- **Nodi disattivabili**: con l'interruttore sul nodo (o dalla sua scheda) un nodo si disattiva: resta fermo al valore che aveva, non risente dei nodi a monte e non trasmette variazioni a valle; diventa grigio e i suoi collegamenti si interrompono. Serve a vedere cosa succede senza un meccanismo (per esempio PEEP senza trasmissione alla pleura, emorragia senza riflesso simpatico). Si possono disattivare tutti i nodi calcolati; impostazioni e caratteristiche del paziente no.
- **Formule semplificate**: dal menu Impostazioni ogni nodo mostra la sua formula in una riga; anche la lavagna delle equazioni ha la vista "Semplificata".
- **Trend** con i marcatori degli interventi.
- **Cosa è successo**: dopo ogni intervento il pannello elenca le variabili cambiate, prima → dopo, e per ciascuna le cause a monte coerenti con il grafo.
- Tempo simulato 1×, 5×, 20×, 60×.
- **Equazioni dal vivo**: dal pannello di un nodo (o con un doppio clic sul nodo) si apre una lavagna con le equazioni del modello per quel nodo, in forma simbolica e con i valori attuali del paziente sostituiti. I numeri si aggiornano in tempo reale e lampeggiano quando cambiano; ogni variabile porta all'equazione del nodo da cui dipende. `test/equations.test.js` verifica che ogni equazione mostrata coincida con il calcolo del modello.
- **Assistente**: pannello in cui descrivere a parole cosa succede o cosa si fa.
  - Nella versione aperta su **claude.ai** risponde Claude: capisce frasi libere ("lo specializzando fa un reclutamento a 40 cmH₂O per 30 secondi"), applica le azioni al simulatore tramite gli strumenti di `window.NodeSim`, fa trascorrere il tempo e spiega gli effetti con i valori del modello. Usa l'utilizzo di Claude di chi lo apre, che la prima volta deve dare il permesso.
  - Altrove (GitHub Pages, file locale) funziona come interprete di comandi in italiano, senza IA: `PEEP 15`, `FiO2 60%`, `reclutamento 40 per 30 s`, `bolo 500 mL`, `avanza 2 minuti`, `ARDS grave`, `pausa espiratoria`, `disattiva pressione pleurica`, `riattiva tutti`, `stato`, `aiuto`.
  - **Versione classica**: la versione precedente resta disponibile in `classic/` (link dal menu Impostazioni) e nel ramo `backup-v1-2d`.

## Modello

Il modello (`js/physiology.js`) è a parametri concentrati e volutamente esplicativo; non sostituisce il Pulse Physiology Engine usato da `breathe.engine`, che resta il riferimento per la simulazione quantitativa. I blocchi principali:

| Blocco | Modello |
| --- | --- |
| Reclutamento | Pressioni di apertura e chiusura distribuite normalmente, con isteresi: le unità si aprono se Pplat > Popen e restano aperte se PEEPtot > Pclose (< Popen). Apertura in secondi, collasso in ~40 s. |
| Meccanica | Curva P-V esponenziale (Salazar-Knowles) del polmone aerato + parete toracica lineare; VC, PC e PS a un compartimento RC; auto-PEEP da tempo espiratorio/costante di tempo; pressione media e potenza meccanica integrate sulla curva di pressione. |
| Pleura | Ppl = Ppl₀ + V/Ccw − Pmus: la frazione di pressione trasmessa dipende dal rapporto tra elastanza della parete e del polmone. |
| Circolo | Modello di Guyton: ritorno venoso (Pmsf − PVC)/RVR intersecato con una curva di Starling in funzione della pressione transmurale (PVC − Ppl − Ppericardica). PVR a U con il volume polmonare, vasocostrizione ipossica, acidosi; funzione VD dipendente dalla PAPm; scarico del VS nella disfunzione sistolica. Riflesso barocettivo e chemocettivo su FC, contrattilità, RVS e venocostrizione. |
| Scambi | Shunt da polmone non aerato (con effetto della portata), compartimento a basso V/Q, contenuti di O₂ con curva di Severinghaus, SvO₂ dal bilancio VO₂/DO₂; spazio morto anatomico + alveolare; PaCO₂ dinamica con depositi di CO₂; pH con Henderson-Hasselbalch e lattato. |

Il catalogo dei nodi (`js/nodes.js`) riporta per ciascun nodo descrizione, formula, range di normalità e relazioni.

## Struttura

```
breathe-nodesim/
├── index.html
├── css/style.css
├── js/physiology.js   modello fisiologico (usabile anche da Node.js)
├── js/nodes.js        catalogo dei nodi e delle relazioni
├── js/graph.js        grafo SVG (pan, zoom, trascinamento, propagazione)
├── js/monitor.js      trend e grafici del pannello nodo
├── js/console.js      console del ventilatore: curve, pause inspiratoria ed espiratoria, loop P-V
├── js/app.js          controlli, manovre, narrazione, loop di simulazione, API window.NodeSim
├── js/equations.js    equazioni dal vivo di ogni nodo (lavagna)
├── js/assistant.js    pannello Assistente (Claude su claude.ai, comandi semplici altrove)
├── classic/           versione precedente (backup)
├── test/physiology.test.js
├── test/equations.test.js
└── test/console.test.js
```
