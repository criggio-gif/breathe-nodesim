# Confronto Pulse – NodeSim: scala di PEEP (1 ottobre 2026, 10 min per livello)

Protocollo: paziente StandardMale di BREATHE senza respiro spontaneo, VC-CMV VT 450 mL, FR 18, Ti 0,9 s, flusso 50 L/min, FiO₂ 0,6; PEEP 0 → 5 → 10 → 15 → 20. Per Pulse, media dell’ultimo mezzo minuto di ogni livello; per NodeSim, valore a fine livello.
La gravità ARDS non ha lo stesso significato nei due modelli: confronta anche gravità diverse a parità di PaO₂ iniziale.

## Polmone sano

| PEEP | Gittata (L/min) P / N | PAM (mmHg) P / N | FC (bpm) P / N | PVC (mmHg) P / N | Ppl media (cmH₂O) P / N | PAP media (mmHg) P / N | PaO₂ (mmHg) P / N | PaCO₂ (mmHg) P / N | Shunt (%) P / N | Cstat (mL/cmH₂O) P / N | Pplat (cmH₂O) P / N | Ppicco (cmH₂O) P / N |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | 5.68 / 5.66 | 95 / 85 | 64 / 74 | 4.8 / 5.7 | -5.4 / 4.3 | 17 / 17 | 311 / 335 | 45 / 33 | 4 / 4 | 46 / 55 | 10 / 8 | 29 / 16 |
| 5 | 5.61 / 5.25 | 95 / 83 | 63 / 77 | 4.8 / 7.0 | -3.4 / 6.6 | 18 / 18 | 339 / 338 | 46 / 34 | 3 / 3 | 49 / 52 | 14 / 14 | 33 / 21 |
| 10 | 5.68 / 4.85 | 95 / 82 | 63 / 81 | 4.8 / 8.3 | -1.8 / 8.8 | 18 / 20 | 341 / 341 | 48 / 35 | 2 / 3 | 52 / 49 | 19 / 19 | 38 / 27 |
| 15 | 5.66 / 4.47 | 95 / 80 | 62 / 85 | 4.9 / 9.5 | -0.5 / 10.9 | 18 / 22 | 342 / 343 | 50 / 36 | 3 / 2 | 54 / 46 | 24 / 25 | 43 / 32 |
| 20 | 5.69 / 4.11 | 95 / 78 | 62 / 89 | 4.9 / 10.8 | 0.6 / 12.9 | 18 / 24 | 344 / 340 | 51 / 38 | 3 / 2 | 55 / 43 | 28 / 31 | 47 / 38 |

PEEP 0 → 20: gittata Pulse 0%, NodeSim -27%; PVC Pulse 0.1, NodeSim 5.1 mmHg; ΔPpl/ΔPEEP Pulse 0.30, NodeSim 0.43; PaO₂ Pulse 33, NodeSim 5 mmHg; Cstat Pulse 9, NodeSim -12 mL/cmH₂O.

## ARDS gravità 0.6

| PEEP | Gittata (L/min) P / N | PAM (mmHg) P / N | FC (bpm) P / N | PVC (mmHg) P / N | Ppl media (cmH₂O) P / N | PAP media (mmHg) P / N | PaO₂ (mmHg) P / N | PaCO₂ (mmHg) P / N | Shunt (%) P / N | Cstat (mL/cmH₂O) P / N | Pplat (cmH₂O) P / N | Ppicco (cmH₂O) P / N |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | 6.58 / 5.69 | 96 / 85 | 114 / 74 | 4.7 / 5.6 | -7.9 / 4.1 | 13 / 25 | 66 / 94 | 68 / 39 | 41 / 25 | 31 / 38 | 15 / 12 | 36 / 19 |
| 5 | 6.72 / 5.40 | 97 / 84 | 140 / 76 | 4.7 / 6.5 | -6.2 / 5.8 | 13 / 26 | 73 / 99 | 75 / 40 | 39 / 23 | 32 / 36 | 19 / 18 | 40 / 25 |
| 10 | 6.80 / 5.09 | 97 / 83 | 140 / 79 | 4.7 / 7.5 | -4.7 / 7.5 | 14 / 26 | 82 / 108 | 78 / 41 | 34 / 20 | 34 / 35 | 24 / 23 | 44 / 30 |
| 15 | 6.69 / 4.78 | 97 / 81 | 140 / 82 | 4.7 / 8.5 | -3.4 / 9.2 | 15 / 28 | 102 / 121 | 79 / 43 | 26 / 16 | 35 / 34 | 28 / 28 | 49 / 36 |
| 20 | 6.65 / 4.45 | 96 / 80 | 140 / 85 | 4.8 / 9.6 | -2.4 / 10.8 | 16 / 33 | 132 / 129 | 79 / 46 | 19 / 14 | 36 / 32 | 33 / 34 | 54 / 42 |

PEEP 0 → 20: gittata Pulse 1%, NodeSim -22%; PVC Pulse 0.1, NodeSim 4.0 mmHg; ΔPpl/ΔPEEP Pulse 0.28, NodeSim 0.34; PaO₂ Pulse 67, NodeSim 35 mmHg; Cstat Pulse 6, NodeSim -6 mL/cmH₂O.

## ARDS gravità 0.85

| PEEP | Gittata (L/min) P / N | PAM (mmHg) P / N | FC (bpm) P / N | PVC (mmHg) P / N | Ppl media (cmH₂O) P / N | PAP media (mmHg) P / N | PaO₂ (mmHg) P / N | PaCO₂ (mmHg) P / N | Shunt (%) P / N | Cstat (mL/cmH₂O) P / N | Pplat (cmH₂O) P / N | Ppicco (cmH₂O) P / N |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | 6.86 / 5.71 | 96 / 85 | 145 / 73 | 4.7 / 5.6 | -8.2 / 4.0 | 13 / 31 | 64 / 70 | 71 / 42 | 41 / 34 | 29 / 29 | 16 / 15 | 37 / 23 |
| 5 | 6.79 / 5.46 | 97 / 84 | 148 / 75 | 4.7 / 6.3 | -6.5 / 5.4 | 13 / 30 | 67 / 74 | 79 / 43 | 42 / 31 | 31 / 29 | 20 / 21 | 42 / 28 |
| 10 | 6.95 / 5.20 | 97 / 83 | 143 / 78 | 4.7 / 7.2 | -5.1 / 6.9 | 13 / 31 | 71 / 81 | 84 / 44 | 41 / 27 | 32 / 29 | 25 / 26 | 46 / 33 |
| 15 | 6.84 / 4.89 | 97 / 82 | 140 / 81 | 4.7 / 8.1 | -3.8 / 8.4 | 13 / 34 | 75 / 89 | 87 / 47 | 39 / 23 | 33 / 28 | 29 / 31 | 50 / 38 |
| 20 | 7.00 / 4.54 | 97 / 80 | 139 / 84 | 4.8 / 9.2 | -2.8 / 9.9 | 14 / 39 | 82 / 94 | 88 / 50 | 34 / 20 | 34 / 27 | 34 / 36 | 55 / 44 |

PEEP 0 → 20: gittata Pulse 2%, NodeSim -20%; PVC Pulse 0.1, NodeSim 3.7 mmHg; ΔPpl/ΔPEEP Pulse 0.27, NodeSim 0.30; PaO₂ Pulse 18, NodeSim 24 mmHg; Cstat Pulse 5, NodeSim -2 mL/cmH₂O.

