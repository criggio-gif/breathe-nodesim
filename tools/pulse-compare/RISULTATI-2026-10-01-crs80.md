# Confronto Pulse – NodeSim: scala di PEEP

Protocollo: paziente StandardMale di BREATHE senza respiro spontaneo, VC-CMV VT 450 mL, FR 18, Ti 0,9 s, flusso 50 L/min, FiO₂ 0,6; PEEP 0 → 5 → 10 → 15 → 20. Per Pulse, media dell’ultimo mezzo minuto di ogni livello; per NodeSim, valore a fine livello.
La gravità ARDS non ha lo stesso significato nei due modelli: confronta anche gravità diverse a parità di PaO₂ iniziale.

## Polmone sano

| PEEP | Gittata (L/min) P / N | PAM (mmHg) P / N | FC (bpm) P / N | PVC (mmHg) P / N | Ppl media (cmH₂O) P / N | PAP media (mmHg) P / N | PaO₂ (mmHg) P / N | PaCO₂ (mmHg) P / N | Shunt (%) P / N | Cstat (mL/cmH₂O) P / N | Pplat (cmH₂O) P / N | Ppicco (cmH₂O) P / N |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | 5.68 / 5.69 | 95 / 85 | 64 / 74 | 4.8 / 5.6 | -5.4 / 4.1 | 17 / 17 | 311 / 292 | 45 / 33 | 4 / 7 | 46 / 78 | 10 / 6 | 29 / 13 |
| 5 | 5.61 / 5.28 | 95 / 84 | 63 / 77 | 4.8 / 6.9 | -3.4 / 6.5 | 18 / 18 | 339 / 290 | 46 / 34 | 3 / 6 | 49 / 79 | 14 / 11 | 33 / 18 |
| 10 | 5.68 / 4.84 | 95 / 82 | 63 / 81 | 4.8 / 8.3 | -1.8 / 8.9 | 18 / 19 | 341 / 308 | 48 / 35 | 2 / 5 | 52 / 80 | 19 / 16 | 38 / 23 |
| 15 | 5.66 / 4.39 | 95 / 79 | 62 / 86 | 4.9 / 9.8 | -0.5 / 11.3 | 18 / 21 | 342 / 327 | 50 / 36 | 3 / 3 | 54 / 81 | 24 / 21 | 43 / 28 |
| 20 | 5.69 / 3.94 | 95 / 77 | 62 / 91 | 4.9 / 11.3 | 0.6 / 13.8 | 18 / 24 | 344 / 334 | 51 / 38 | 3 / 2 | 55 / 81 | 28 / 26 | 47 / 33 |

PEEP 0 → 20: gittata Pulse 0%, NodeSim -31%; PVC Pulse 0.1, NodeSim 5.7 mmHg; ΔPpl/ΔPEEP Pulse 0.30, NodeSim 0.48; PaO₂ Pulse 33, NodeSim 42 mmHg; Cstat Pulse 9, NodeSim 2 mL/cmH₂O.

## ARDS gravità 0.6

| PEEP | Gittata (L/min) P / N | PAM (mmHg) P / N | FC (bpm) P / N | PVC (mmHg) P / N | Ppl media (cmH₂O) P / N | PAP media (mmHg) P / N | PaO₂ (mmHg) P / N | PaCO₂ (mmHg) P / N | Shunt (%) P / N | Cstat (mL/cmH₂O) P / N | Pplat (cmH₂O) P / N | Ppicco (cmH₂O) P / N |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | 6.58 / 5.73 | 96 / 85 | 114 / 73 | 4.7 / 5.5 | -7.9 / 3.9 | 13 / 26 | 66 / 84 | 68 / 39 | 41 / 28 | 31 / 37 | 15 / 12 | 36 / 20 |
| 5 | 6.72 / 5.49 | 97 / 84 | 140 / 75 | 4.7 / 6.2 | -6.2 / 5.2 | 13 / 26 | 73 / 94 | 75 / 40 | 39 / 24 | 32 / 39 | 19 / 17 | 40 / 24 |
| 10 | 6.80 / 5.22 | 97 / 83 | 140 / 78 | 4.7 / 7.1 | -4.7 / 6.8 | 14 / 26 | 82 / 109 | 78 / 41 | 34 / 20 | 34 / 41 | 24 / 21 | 44 / 28 |
| 15 | 6.69 / 4.92 | 97 / 82 | 140 / 80 | 4.7 / 8.0 | -3.4 / 8.4 | 15 / 28 | 102 / 128 | 79 / 43 | 26 / 16 | 35 / 43 | 28 / 26 | 49 / 33 |
| 20 | 6.65 / 4.61 | 96 / 81 | 140 / 83 | 4.8 / 9.1 | -2.4 / 10.0 | 16 / 33 | 132 / 136 | 79 / 46 | 19 / 14 | 36 / 39 | 33 / 31 | 54 / 39 |

PEEP 0 → 20: gittata Pulse 1%, NodeSim -20%; PVC Pulse 0.1, NodeSim 3.6 mmHg; ΔPpl/ΔPEEP Pulse 0.28, NodeSim 0.30; PaO₂ Pulse 67, NodeSim 52 mmHg; Cstat Pulse 6, NodeSim 3 mL/cmH₂O.

## ARDS gravità 0.85

| PEEP | Gittata (L/min) P / N | PAM (mmHg) P / N | FC (bpm) P / N | PVC (mmHg) P / N | Ppl media (cmH₂O) P / N | PAP media (mmHg) P / N | PaO₂ (mmHg) P / N | PaCO₂ (mmHg) P / N | Shunt (%) P / N | Cstat (mL/cmH₂O) P / N | Pplat (cmH₂O) P / N | Ppicco (cmH₂O) P / N |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | 6.86 / 5.73 | 96 / 85 | 145 / 73 | 4.7 / 5.5 | -8.2 / 3.9 | 13 / 34 | 64 / 67 | 71 / 42 | 41 / 36 | 29 / 26 | 16 / 17 | 37 / 25 |
| 5 | 6.79 / 5.55 | 97 / 85 | 148 / 75 | 4.7 / 6.0 | -6.5 / 4.9 | 13 / 31 | 67 / 73 | 79 / 43 | 42 / 32 | 31 / 29 | 20 / 21 | 42 / 28 |
| 10 | 6.95 / 5.32 | 97 / 84 | 143 / 77 | 4.7 / 6.8 | -5.1 / 6.2 | 13 / 30 | 71 / 88 | 84 / 44 | 41 / 25 | 32 / 32 | 25 / 24 | 46 / 32 |
| 15 | 6.84 / 5.05 | 97 / 83 | 140 / 79 | 4.7 / 7.6 | -3.8 / 7.6 | 13 / 33 | 75 / 99 | 87 / 46 | 39 / 21 | 33 / 33 | 29 / 29 | 50 / 36 |
| 20 | 7.00 / 4.69 | 97 / 81 | 139 / 83 | 4.8 / 8.7 | -2.8 / 8.9 | 14 / 42 | 82 / 98 | 88 / 51 | 34 / 19 | 34 / 30 | 34 / 35 | 55 / 43 |

PEEP 0 → 20: gittata Pulse 2%, NodeSim -18%; PVC Pulse 0.1, NodeSim 3.3 mmHg; ΔPpl/ΔPEEP Pulse 0.27, NodeSim 0.25; PaO₂ Pulse 18, NodeSim 32 mmHg; Cstat Pulse 5, NodeSim 3 mL/cmH₂O.

