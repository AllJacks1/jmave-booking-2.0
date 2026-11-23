# Workbook formula dumps

Raw cell dumps of the pricing tabs in `Self-Driven and With Driver.xlsx`, for checking a rule in `docs/reference/pricing.md` against the original formula. These tabs hold no client data.

Format, one cell per line:

```
<cell>\t=<formula, if any>\t|| <cached value>
```

`[shared from X1]` means the cell reuses the formula written in X1 (Excel shared formula), with references shifted.

| File | Tab |
|---|---|
| `FORMULA.txt` | `FORMULA` — Self-Drive engine and rate tables |
| `QP_FORMULA.txt` | `QP FORMULA` — alternative "quotation purpose" Self-Drive rates (draft rate card, PLAN Q3) |
| `SELF_DRIVE_COMPUTATION.txt` | `SELF DRIVE COMPUTATION AND ITENERARY` — Self-Drive input sheet |
| `FORMULA_WDRIVER.txt` | `FORMULA WDRIVER` — With Driver engine and rate tables |
| `WITH_DRIVER_COMPUTATION.txt` | `WITH DRIVER COMPUTATION` — With Driver input sheet |
| `SPECS.txt` | `SPECS` — fleet details |

Cached values are a snapshot from 2026-11-23 and reflect whatever quote was open in the sheet then. `pricing.md` wins where they differ (bug fixes, §6).
