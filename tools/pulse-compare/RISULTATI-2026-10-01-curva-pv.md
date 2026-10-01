# Confronto Pulse – NodeSim: scala di PEEP

Protocollo: paziente StandardMale di BREATHE senza respiro spontaneo, VC-CMV VT 450 mL, FR 18, Ti 0,9 s, flusso 50 L/min, FiO₂ 0,6; PEEP 0 → 5 → 10 → 15 → 20. Per Pulse, media dell’ultimo mezzo minuto di ogni livello; per NodeSim, valore a fine livello.
La gravità ARDS non ha lo stesso significato nei due modelli: confronta anche gravità diverse a parità di PaO₂ iniziale.

## Polmone sano

| PEEP | Gittata (L/min) P / N | PAM (mmHg) P / N | FC (bpm) P / N | PVC (mmHg) P / N | Ppl media (cmH₂O) P / N | PAP media (mmHg) P / N | PaO₂ (mmHg) P / N | PaCO₂ (mmHg) P / N | Shunt (%) P / N | Cstat (mL/cmH₂O) P / N | Pplat (cmH₂O) P / N | Ppicco (cmH₂O) P / N |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | 5.68 / 5.66 | 95 / 85 | 64 / 74 | 4.8 / 5.7 | -5.4 / 4.3 | 17 / 17 | 311 / 291 | 45 / 33 | 4 / 7 | 46 / 56 | 10 / 8 | 29 / 16 |
| 5 | 5.61 / 5.24 | 95 / 83 | 63 / 77 | 4.8 / 7.0 | -3.4 / 6.7 | 18 / 18 | 339 / 299 | 46 / 34 | 3 / 6 | 49 / 56 | 14 / 13 | 33 / 21 |
| 10 | 5.68 / 4.80 | 95 / 81 | 63 / 82 | 4.8 / 8.4 | -1.8 / 9.1 | 18 / 19 | 341 / 319 | 48 / 35 | 2 / 4 | 52 / 57 | 19 / 18 | 38 / 25 |
| 15 | 5.66 / 4.35 | 95 / 79 | 62 / 86 | 4.9 / 9.9 | -0.5 / 11.5 | 18 / 21 | 342 / 334 | 50 / 36 | 3 / 3 | 54 / 58 | 24 / 23 | 43 / 30 |
| 20 | 5.69 / 3.90 | 95 / 77 | 62 / 91 | 4.9 / 11.5 | 0.6 / 14.0 | 18 / 24 | 344 / 337 | 51 / 38 | 3 / 2 | 55 / 56 | 28 / 28 | 47 / 36 |

PEEP 0 → 20: gittata Pulse 0%, NodeSim -31%; PVC Pulse 0.1, NodeSim 5.8 mmHg; ΔPpl/ΔPEEP Pulse 0.30, NodeSim 0.48; PaO₂ Pulse 33, NodeSim 45 mmHg; Cstat Pulse 9, NodeSim 0 mL/cmH₂O.

## ARDS gravità 0.6

| PEEP | Gittata (L/min) P / N | PAM (mmHg) P / N | FC (bpm) P / N | PVC (mmHg) P / N | Ppl media (cmH₂O) P / N | PAP media (mmHg) P / N | PaO₂ (mmHg) P / N | PaCO₂ (mmHg) P / N | Shunt (%) P / N | Cstat (mL/cmH₂O) P / N | Pplat (cmH₂O) P / N | Ppicco (cmH₂O) P / N |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | 6.58 / 5.69 | 96 / 85 | 114 / 74 | 4.7 / 5.6 | -7.9 / 4.1 | 13 / 26 | 66 / 83 | 68 / 39 | 41 / 28 | 31 / 39 | 15 / 12 | 36 / 19 |
| 5 | 6.72 / 5.39 | 97 / 84 | 140 / 76 | 4.7 / 6.6 | -6.2 / 5.8 | 13 / 26 | 73 / 91 | 75 / 40 | 39 / 25 | 32 / 41 | 19 / 16 | 40 / 24 |
| 10 | 6.80 / 5.04 | 97 / 83 | 140 / 79 | 4.7 / 7.7 | -4.7 / 7.8 | 14 / 26 | 82 / 104 | 78 / 41 | 34 / 20 | 34 / 43 | 24 / 20 | 44 / 28 |
| 15 | 6.69 / 4.67 | 97 / 81 | 140 / 83 | 4.7 / 8.9 | -3.4 / 9.8 | 15 / 27 | 102 / 122 | 79 / 43 | 26 / 16 | 35 / 44 | 28 / 25 | 49 / 33 |
| 20 | 6.65 / 4.24 | 96 / 79 | 140 / 87 | 4.8 / 10.3 | -2.4 / 11.8 | 16 / 34 | 132 / 124 | 79 / 48 | 19 / 14 | 36 / 39 | 33 / 32 | 54 / 39 |

PEEP 0 → 20: gittata Pulse 1%, NodeSim -25%; PVC Pulse 0.1, NodeSim 4.7 mmHg; ΔPpl/ΔPEEP Pulse 0.28, NodeSim 0.39; PaO₂ Pulse 67, NodeSim 41 mmHg; Cstat Pulse 6, NodeSim -0 mL/cmH₂O.

## ARDS gravità 0.85

| PEEP | Gittata (L/min) P / N | PAM (mmHg) P / N | FC (bpm) P / N | PVC (mmHg) P / N | Ppl media (cmH₂O) P / N | PAP media (mmHg) P / N | PaO₂ (mmHg) P / N | PaCO₂ (mmHg) P / N | Shunt (%) P / N | Cstat (mL/cmH₂O) P / N | Pplat (cmH₂O) P / N | Ppicco (cmH₂O) P / N |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | 6.86 / 5.70 | 96 / 85 | 145 / 73 | 4.7 / 5.6 | -8.2 / 4.0 | 13 / 34 | 64 / 65 | 71 / 43 | 41 / 37 | 29 / 31 | 16 / 15 | 37 / 22 |
| 5 | 6.79 / 5.45 | 97 / 84 | 148 / 76 | 4.7 / 6.4 | -6.5 / 5.5 | 13 / 31 | 67 / 71 | 79 / 43 | 42 / 33 | 31 / 34 | 20 / 18 | 42 / 26 |
| 10 | 6.95 / 5.15 | 97 / 83 | 143 / 78 | 4.7 / 7.3 | -5.1 / 7.2 | 13 / 31 | 71 / 81 | 84 / 44 | 41 / 27 | 32 / 36 | 25 / 22 | 46 / 30 |
| 15 | 6.84 / 4.78 | 97 / 81 | 140 / 82 | 4.7 / 8.5 | -3.8 / 9.1 | 13 / 33 | 75 / 92 | 87 / 47 | 39 / 21 | 33 / 36 | 29 / 27 | 50 / 35 |
| 20 | 7.00 / 4.31 | 97 / 79 | 139 / 88 | 4.8 / 10.1 | -2.8 / 10.9 | 14 / 47 | 82 / 90 | 88 / 55 | 34 / 19 | 34 / 30 | 34 / 35 | 55 / 42 |

PEEP 0 → 20: gittata Pulse 2%, NodeSim -24%; PVC Pulse 0.1, NodeSim 4.5 mmHg; ΔPpl/ΔPEEP Pulse 0.27, NodeSim 0.34; PaO₂ Pulse 18, NodeSim 25 mmHg; Cstat Pulse 5, NodeSim -0 mL/cmH₂O.

