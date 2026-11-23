# Bookings, calendar, Daily Movement board, roster

## 1. Booking record

Replaces the free-text note staff used to paste into Google Calendar events. Every field below is a real column (see PLAN §4), not a notes blob.

| Group | Fields |
|---|---|
| Header | number (= quotation number), service (Self-Drive / With Driver), status, vehicle, created by, confirmed by/at |
| Schedule | start_at (release), end_at (return), destination |
| Client | link to client: full name, contact no., complete address, birthday, email, alternative contact person + number |
| Driver (Self-Drive) | driver's name on license (may differ from client), driver's license no., IDs presented (multi-select: Driver's License, Passport, UMID, PhilSys, Senior Citizen, PRC, Postal, Voter's, Company ID, Other) |
| Driver (With Driver) | assigned driver (from `drivers`), passengers, luggage, itinerary |
| Delivery | delivery address (FD), pick-up address (PU). Fees are quote lines, charged per way |
| Source | channel (`facebook, whatsapp, viber, phone, walk_in, website, referral, other`), contact handle, Rework inbox link (URL) |
| Finance | charges (from quote + check-in), payments ledger, balance, "OR issued" checkbox |
| Notes | free text for anything else |

Calendar event title format (used on calendar and board): `FD WIGO GRAY - <client name>` → movement code + vehicle short name + client.

## 2. Status flow

Matches the team's Process Flow:

```
quotation issued
   └─(convert)→ pending_reservation ──(confirm: RF paid)→ confirmed ──(release check-in)→ released
                      │                                     │                              │
                      └──────────→ cancelled ←──────────────┘                     (return check-in)
                                                                                           ↓
                                         closed ←──(deposit refunded / settled)── returned
   confirmed ──(client did not show)→ no_show
```

- **Convert** (Sales+): creates the booking from an issued formal quotation; copies client, vehicle, schedule, lines.
- **Confirm** (Sales+): requires at least one `reservation_fee` payment (or an explicit "confirm without RF" with reason, Admin+). Inserts the vehicle hold (PLAN §6.2). Fails on conflict.
- **Release** (Ops+): see §5.
- **Return** (Ops+): see §5.
- **Close** (Sales+): allowed when balance = 0 and deposit refunded or applied.
- Each transition writes `audit_log`.

## 3. Payments ledger and balance

Entries in `payments` are immutable; mistakes are **voided** (Admin+) and re-entered.

| Type | Direction | Example |
|---|---|---|
| reservation_fee | in | ₱500 via GCash, ref 9047… |
| delivery_fee | in | ₱490 via GCash |
| rental | in | ₱3,500 cash on turnover |
| deposit | in | ₱2,000 cash |
| change_given | out | ₱299 change given by a driver |
| deposit_refund | out | ₱2,000 GCash refund after return |
| other | in/out | anything else, with note |

Each entry: amount, method (`cash, gcash, card, bank, other`), reference no., collected/paid by (staff user **or** free-text name such as a driver), date/time, note.

```
charges   = sum(booking_charges)                      -- quoted lines + check-in extras
paid_in   = sum(payments in, not voided, excluding deposit)
paid_out  = sum(payments out, not voided, excluding deposit_refund)
balance   = charges − paid_in + paid_out
deposit_held = deposit in − deposit_refund out
```

Show balance and deposit held on the booking page and on the board. A real example the ledger must express: rental total 2,191 + deposit 2,000; 990 paid by GCash before release; 3,500 cash at turnover; 299 change given back → rental balance 0, deposit held 2,000.

## 4. Fleet calendar (Phase 2a)

- Custom component (no paid calendar libraries). Rows = vehicles (grouped by body type, `sort_order`), columns = days; week and month views; horizontal scroll on small screens.
- Bars = bookings and blocks. Colour by status: pending (striped), confirmed, released, returned, block (grey). Label = movement code + client.
- Click empty cell (Sales+) → "New quotation" for that vehicle and date. Click bar → booking drawer.
- Filters: body type, status, service.
- Operations sees the same calendar read-only.

## 5. Release and Return check-in (Phase 2b, Ops+)

**Release:** actual date/time (default now), odometer km, fuel level (0–8 eighths), delivery done (if FD), notes. Status → `released`.

**Return:** actual date/time, odometer km, fuel level, pick-up done (if PU), notes. The system then:

1. Computes actual km = return odo − release odo, and excess km per `pricing.md` §1 using the **billed rental days** (booked days + extension days). Minus any excess km already charged on the quote. Adds a `booking_charges` row `excess_km` if > 0.
2. Fuel shortage if return fuel < release fuel: `(tank_capacity_l × missing eighths ÷ 8) × fuel price` (PLAN Q6). Adds `fuel_shortage` row.
3. Late return: if the car is back more than 60 minutes after `end_at` (grace, setting `late_return_grace_minutes`, PLAN Q11), charge **all** late hours, rounded up to whole hours, at the hourly extension rate (Self-Drive) or the excess-hour rate (With Driver). Adds `extension` row.

Staff can remove any auto row with a reason (Admin+).
4. Status → `returned`; hold end = actual return + buffer.

Both forms must work well on a phone (Ops uses phones in the field).

## 6. Daily Movement board (Phase 2b) — replaces the DMS sheet

Route `/board?date=YYYY-MM-DD` (default today, Asia/Manila). Ops lands here.

| Section | Content | Old DMS equivalent |
|---|---|---|
| Header | date, "as of" time, refresh | `J-MaVe DAILY MOVEMENT SHEET 10:00 AM` |
| Fleet status | one row per active vehicle: #, car, client, destination, status for the day, daily rate | columns K–W |
| Day status values | `Available`, `Rented` (released and not due today), `Out today` (release today), `Return` (due back today), `Blocked` (block or owner use), `Pending reservation` | legend `Available / Rented / Return / Blocked / Pending Reservation` |
| Movement timeline | 30-minute slots 00:00–24:00; each event as a chip: `OUT` (release), `IN` (return), `EXT` (extension), with code `FD` (for delivery), `PU` (for pick-up), `WD` (with driver), `PR` (pending reservation) and planned time; actual time once checked in | columns B–H (TIME / OUT / Extend / IN) |
| 5-day look-ahead | per vehicle, next 5 days: code + time of each movement | `LOOK AHEAD (5 DAYS)` |
| With Driver trips | client, car, plate, assigned driver (or "Waiting driver…"), times | `WITH DRIVER TRIPS` |
| Special instructions | each FD/PU today: car + delivery/pick-up address; plus booking notes flagged "show on board" | `SPECIAL INSTRUCTION` |
| Shift roster | who is on duty today per shift (Ops / Sales) | `LOOK AHEAD (CRITICAL HOURS)` + `DMS Schedule` |

- Actions on a row (by role): Release, Return (Ops+); open booking (Sales+).
- "Print / PDF" button: one A4 landscape page of the board for the day.
- Auto-refresh every 60 s (or on focus).

## 7. Vehicle blocks

Kinds: `owner_use`, `maintenance`, `hired_out` (sub-leased), `reserved` (manual hold), `other`. Each has start, end, reason. Blocks use `vehicle_holds` so they also prevent double booking. Shown grey on calendar and as `Blocked` on the board.

## 8. Drivers

`drivers`: name, phone, active. Not system users. Seed from `Back bone WDRIVER!M` (driver names) and `N` (contact). A driver cannot be assigned to two overlapping With Driver bookings (check in app code; warn, Admin+ can override).

## 9. Shift roster (Phase 2b)

- Templates (seed): `5AM–2PM`, `8AM–5PM`, `10AM–7PM`, `1PM–10PM`, `9PM–6AM` (crosses midnight).
- Assignment: date × user × template × duty (`operations` or `sales`).
- Week grid editor (Admin+), copy previous week, everyone can view.
- Board shows today's roster; dashboard shows "on duty now".
- DMS update times from the old sheet (Morning 06:00/09:00/12:00/14:00, Mid 16:00/19:00/22:00, GY 00:00/03:00/05:00) are not needed: the board is live.
