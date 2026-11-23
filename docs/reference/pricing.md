# Pricing rules

Source of truth for `src/lib/pricing/`. Derived from the formulas in `Self-Driven and With Driver.xlsx` (raw dumps in `docs/reference/workbook/`), **with the bugs in §6 fixed**.

All amounts below are pesos for readability. The engine works in **integer centavos**. Round each line to the centavo (half-up) and never round intermediate sums except where a rule says so.

## 1. Shared definitions

**Body types:** `compact, sedan, wagon, mpv, suv, pickup, van`.

**Categories:** apply to `sedan` (`budgetmile, primo, premium`), `mpv` and `suv` (`budgetmile, primo`). The With Driver sheet calls Budgetmile "Regular"; treat them as the same. Other body types have one standard rate.

**Vehicle class table** (same for both services; `FORMULA!H64:M71`, `FORMULA WDRIVER!C44:H51`):

| Body type | km per liter | Carwash | CDW per day | Excess ₱/km |
|---|---|---|---|---|
| compact | 10 | 200 | 350 | 4 |
| sedan | 10 | 200 | 350 | 4 |
| wagon | 9 | 250 | 500 | 5 |
| mpv | 9 | 250 | 500 | 5 |
| suv | 8 | 300 | 500 | 5 |
| pickup | 8 | 300 | 500 | 5 |
| van | 7 | 350 | 500 | 5 |

**Fuel price used:** if a specific vehicle is chosen, its `fuel_type` (`gasoline`, `premium`, `diesel`). Otherwise by body type: compact, sedan, wagon, mpv use gasoline; suv, pickup, van use diesel. Prices are inputs on the quote, defaulted from settings (`fuel_price_gasoline`, `fuel_price_premium`, `fuel_price_diesel`).

**Terminal fee:** 3.5% of the amount, **only when paid by card**. Cash, GCash and bank transfer: 0. Applied separately to the rental total, the reservation fee and the deposit, each with its own payment method.

**Mileage allowance:** 150 km **per rental day**.

**Excess mileage:** `max(0, roundTripKm − 150 × days) × excessRate`.

## 2. Self-Drive

### 2.1 Inputs

| Input | Values |
|---|---|
| bodyType, category | see §1 |
| hoursTier | `8`, `12`, `24` |
| days | integer ≥ 1 |
| additionalHoursBlock | none, `8`, `12` (one extra partial day) |
| extensionHours | integer ≥ 0 |
| beyondOperatingHours | none, `22:01–05:29` |
| otPremiumSlot | none, `19:01–01:00`, `01:01–06:00` |
| withCdw | boolean |
| sevenDayDiscount | boolean |
| promo | none, `APRIL_TIERED`, `CITY_SAVER`, `CITY_SAVER_PLUS` |
| clientIsRepeat | boolean (from client history; overridable) |
| deliveryFee, pickupFee | pesos, typed by staff (per way) |
| oneWayDistanceKm | number ≥ 0 |
| includeFuel | boolean, default true (PLAN Q2) |
| fuelPrices | from settings, overridable |
| reservationFee, deposit | pesos (typical: reservation 500, deposit 2,000) |
| paymentMethod (rental / reservation / deposit) | `cash, gcash, card, bank` |
| rewardsRedemption | Phase 3: points as pesos or free hours |

### 2.2 Daily rates (`FORMULA`)

| Body type | 24h | 12h | 8h | Cell source |
|---|---|---|---|---|
| sedan budgetmile | 1,790 | 1,680 | 1,050 | `H34:K34` (I=24, J=12, K=8) |
| sedan primo | 1,890 | 1,700 | 1,100 | `H35:K35` |
| sedan premium | 2,000 | 1,800 | 1,200 | `H36:K36` |
| mpv budgetmile | 2,420 | 2,310 | 1,580 | `H41:K41` |
| mpv primo | 2,630 | 2,520 | 1,790 | `H42:K42` |
| suv budgetmile | 3,470 | 3,370 | 2,630 | `H48:K48` |
| suv primo | 3,680 | 3,580 | 2,840 | `H49:K49` |
| compact | 1,580 | 1,470 | 950 | `H56:O59` column I (rows 57=8h, 58=12h, 59=24h) |
| wagon | 2,310 | 2,210 | 1,580 | column K |
| pickup | 3,299 | 3,199 | 2,500 | column N |
| van | 4,500 | 4,500 | 3,500 | column O |

**Additional hours block** (`FORMULA!Q57:X59`, row 58 = 8h, row 59 = 12h, columns R..X = compact, sedan, wagon, mpv, suv, pickup, van):

| | compact | sedan | wagon | mpv | suv | pickup | van |
|---|---|---|---|---|---|---|---|
| 8h | 950 | 1,100 | 1,580 | 1,790 | 2,840 | 2,500 | 2,500 |
| 12h | 1,470 | 1,700 | 2,210 | 2,520 | 3,580 | 3,199 | 3,400 |

**Hourly extension** (`FORMULA!J95:K101`): compact 300, sedan 300, wagon 350, mpv 350, suv 400, pickup 400, van **500** (missing in sheet, PLAN Q7).

### 2.3 Lines, in this order

1. **Rental rate** = `dailyRate × days`.
   - If `sevenDayDiscount` and `days > 6`: dailyRate − ₱100 first.
   - If promo `CITY_SAVER` / `CITY_SAVER_PLUS`: rental rate = flat ₱4,799 / ₱5,299 instead (PLAN Q8).
   - Remark text: `(2,630 × 1) = 2,630`.
2. **Additional hours** = block price from §2.2, once. Omit line if none.
3. **CDW** (if `withCdw`) = `cdwPerDay × days`, plus one more `cdwPerDay` if an additional-hours block exists.
4. **Carwash** = class carwash, once.
5. **Delivery fee**, **Pick-up fee** = as typed. Omit if 0.
6. **OT premium** (release or return in an off-hours slot): `19:01–01:00` ₱500, `01:01–06:00` ₱300, once. (In the old sheet this table existed but was not wired.)
7. **Beyond operating hours** = ₱500 × days if slot `22:01–05:29` chosen.
8. **Hourly extension** = rate × extensionHours.
9. **Fuel** (if `includeFuel`) = `oneWayKm × 2 ÷ kmPerLiter × fuelPrice`.
10. **Excess mileage** = §1 with `roundTripKm = oneWayKm × 2`.

**Subtotal** = sum of lines 1–10.

**Discounts** (shown as negative lines):

- **Promo `APRIL_TIERED`**: 10% of line 1 if days 1–4; **15%** if days ≥ 5.
- **New client discount**: 5% of line 1, only if `!clientIsRepeat`.
- Rewards redemption (Phase 3).

**Rental total** = subtotal − discounts.

**Payable block** (shown on formal quote):

- Terminal fees per §1.
- **Reservation fee (today)** and **Delivery fee (today)** are collected upfront.
- **Refundable security deposit** = deposit.
- **Total contract value** = rental total + deposit + terminal fees.
- **Balance on release** = total contract value − reservation fee − delivery fee.

## 3. With Driver

### 3.1 Inputs

| Input | Values |
|---|---|
| bodyType, category | see §1 |
| startAt, endAt (first day) | datetime; gives **contractHours** per day |
| days | integer ≥ 1 |
| oneWayDistanceKm | number ≥ 0 |
| pricingBasis | `all_in` (we buy fuel) or `renters_fuel` |
| additionalHoursBlock | none, `8`, `12` |
| package | `round_trip`, `pickup_dropoff`, `airport_transfer` |
| drivingTerm | `back_and_forth`, `long_term_parking` (driver stays at destination) |
| driverRateMode | `contract_rate` (default), `working_hour` |
| event | `regular`, `holiday` (auto from holiday list on start date, overridable) |
| clientType | `individual`, `corporate` |
| corporateMarkupPct | number, only for corporate |
| serviceArea | `mindanao`, `davao_region`, `within_davao_city` |
| mealPerDay, accommodationPerDay | pesos, typed by staff. Suggested meal: 8h ₱100, 10h ₱200, 12h ₱200, 24h ₱300 |
| fuelPrices, reservationFee, paymentMethods, discount | as Self-Drive |

**Hours tier** = smallest of `8, 10, 12, 24` that is ≥ contractHours. Above 24 is invalid for one day; split into days.

### 3.2 Rates (`FORMULA WDRIVER`)

**Daily rate, trips of 1–14 days** (category tables `C15:G18` sedan, `C22:G24` mpv, `C28:G30` suv with D=24, E=12, F=10, G=8; others from `C35:J39` rows 36/37/38/39 = 8/10/12/24h, columns D compact, F wagon, I pickup, J van):

| | 24h | 12h | 10h | 8h |
|---|---|---|---|---|
| sedan budgetmile | 1,790 | 1,680 | 1,580 | 1,050 |
| sedan primo | 1,890 | 1,700 | 1,600 | 1,100 |
| sedan premium | 2,000 | 1,800 | 1,700 | 1,200 |
| mpv budgetmile | 2,420 | 2,310 | 2,310 | 1,580 |
| mpv primo | 2,630 | 2,520 | 2,520 | 1,790 |
| suv budgetmile | 3,470 | 3,370 | 3,370 | 2,630 |
| suv primo | 3,680 | 3,580 | 3,580 | 2,840 |
| compact | 1,580 | 1,470 | 1,370 | 950 |
| wagon | 2,310 | 2,210 | 2,110 | 1,580 |
| pickup | 3,299 | 3,199 | 3,099 | 2,500 |
| van | 4,500 | 3,500 | 3,500 | 3,500 |

**Long-term daily rate** (`C3:M13`; for 15–29 days use the "15–29 Days" column, for 30+ days the "30 Days" column), by service area:

| | Mindanao 30d / 15–29d | Davao Region 30d / 15–29d | Within Davao City 30d / 15–29d |
|---|---|---|---|
| compact | 1,800 / 2,160 | 1,300 / 1,560 | 1,000 / 1,200 |
| sedan | 2,000 / 2,400 | 1,500 / 1,800 | 1,200 / 1,440 |
| mpv | 2,350 / 2,820 | 1,850 / 2,220 | 1,500 / 1,800 |
| suv | 2,850 / 3,420 | 2,350 / 2,820 | 2,000 / 2,400 |
| pickup | 2,850 / 3,420 | 2,350 / 2,820 | 2,000 / 2,400 |
| van | 2,850 / 3,420 | 2,350 / 2,820 | 2,000 / 2,400 |
| wagon | 2,350 / 2,820 | 1,850 / 2,220 | 2,200 / 2,640 |

(Wagon "Within Davao City" is higher than MPV in the sheet. Import as-is; flag in the rate-card UI.)

**Additional hours block, car** (`C96:J98`, row 97 = 8h, row 98 = 12h): compact 899 / 1,399; sedan 1,200 / 1,800; wagon 1,500 / 2,099; mpv 1,500 / 2,199; suv 2,500 / 3,199; pickup 2,500 / 3,199; van 2,500 / 4,000.

**Driver fee by one-way distance** (`C115:K119`; columns D..K are bands; rows 116–119 = 8/10/12/24h). Above 500 km use the last band.

| Hours | 1–70 | 71–110 | 111–150 | 151–190 | 191–230 | 231–270 | 271–310 | 311–500 |
|---|---|---|---|---|---|---|---|---|
| 8 | 600 | 700 | 800 | 900 | 1,000 | 1,100 | 1,400 | 1,800 |
| 10 | 750 | 900 | 1,000 | 1,100 | 1,200 | 1,300 | 1,600 | 2,000 |
| 12 | 850 | 1,100 | 1,200 | 1,300 | 1,400 | 1,500 | 1,800 | 2,200 |
| 24 | 1,000 | 1,400 | 1,500 | 1,600 | 1,700 | 1,800 | 1,900 | 2,300 |

**Additional hours block, driver** (`C123:K125`): the 8h and 12h rows of the table above, by the same band.

**Stored but unused** (PLAN Q4): Pick-up/Drop-off rate (`C76:D82`): compact 899, sedan 999, wagon 1,500, mpv 1,500, suv 2,500, pickup 2,500, van 2,500. Van distance rate (`K268:L270`): 1–150 km 3,500; 151+ km 4,500.

**Excess-hour rates for the client copy** (`Back bone WDRIVER!Q2:S9`, renter's fuel / all-in): compact 400/500, sedan 400/500, wagon 450/550, mpv 450/550, suv 500/600, pickup 500/600, van 500/600. Shown as "Supplemental charges", not added to the total.

### 3.3 Driver fee

- `contract_rate`: `fee = table[hoursTier][band(oneWayKm)]`.
- `working_hour`: allowed only for `pickup_dropoff` / `airport_transfer` with oneWayKm < 23. Fee = ₱200.
- `holiday`: fee × 2 (PLAN: the old sheet intended this in `E137` but wired it wrong; confirm with owner).
- **Back and forth:** Driver's fee line = `fee × days`.
- **Long-term parking:** first day `fee`; if days ≥ 2, last day `fee`; if days ≥ 3, standby `(fee − 500) × (days − 2)`. Three separate lines.

### 3.4 Lines, in this order

1. **Rental rate** = rate × days (`pickup_dropoff` / `airport_transfer`: × 1).
2. **Additional hours (car)**, once.
3. **CDW** = cdwPerDay × days (always included for With Driver).
4. **Carwash**, once.
5. **Driver's fee** line(s) per §3.3.
6. **Additional hours (driver)**, once.
7. **Accommodation** = accommodationPerDay × days. Omit if 0.
8. **Meal** = mealPerDay × days. Omit if 0.
9. **Fuel** (`all_in` only) = `oneWayKm × 2.2 ÷ kmPerLiter × fuelPrice`. The 2.2 factor is round trip + 10% buffer.
10. **Excess mileage** = §1 with `roundTripKm = oneWayKm × 2`.
11. **Night differential** = `driverFee × 10% × nightHours ÷ contractHours × days`, where nightHours is the overlap of the first day's contract window with 22:01–06:00.

Then:

12. **Rounding adjustment** = `ceil(sum(1–11) to the next ₱100) − sum(1–11)`. Omit if 0. (PLAN Q1.)
13. **Service fee** = ₱500.

**Subtotal** = sum of 1–13. **Less discount** (typed). **Total** = subtotal − discount.
**Terminal fees** per §1 on total and on reservation fee.
**Corporate mark-up** = (total + terminal fees) × corporateMarkupPct, if corporate.
**Grand total** = total + terminal fees + corporate mark-up.

## 4. Rewards (Phase 3)

- Earn: 50 points × rental days when a booking reaches `returned`.
- Value: 50 points = ₱1.
- Redeem as discount: `pesos = floor(points ÷ 50)`. Shown as a negative line "Rewards redemption".
- Redeem as free hours: `points = hours × hourlyExtensionRate(bodyType) × 50` (Self-Drive table §2.2; for With Driver use the same table). Adds a line "Free hours (rewards)" for the hours at ₱0 and records the points spent.
- Redemption cannot make the rental total negative.

## 5. Quotation validity

`valid_until = issued_at + 24 hours` (setting `quote_validity_hours`). Shown with date and time in Asia/Manila.

## 6. Old-sheet bugs and how the engine fixes them

| # | Old behaviour | New rule |
|---|---|---|
| B1 | Self-Drive fuel and excess km computed but never added to the total | Added as lines 9–10 (fuel behind `includeFuel`) |
| B2 | April promo always 10% | 10% for 1–4 days, 15% for 5+ |
| B3 | Self-Drive mileage allowance flat 150 km | 150 km × days |
| B4 | Client copy omitted carwash (log column not saved) | Quote stores all lines; client copy prints from the stored result |
| B5 | Client copy "Remarks" showed amounts as dates | Remarks are text from the engine |
| B6 | Long-term parking with 1 day: standby −₱250 and last-day fee double-charged | Lines only for days ≥ 2 / ≥ 3 (§3.3) |
| B7 | With Driver hidden ₱500 + hidden rounding | Visible "Service fee" and "Rounding adjustment" lines |
| B8 | Contract hours not exactly 8/10/12/24 → `#N/A` | Next tier up |
| B9 | Blank "Additional Hrs" → `#N/A` | Line omitted |
| B10 | GCash rental payment got the 3.5% terminal fee; GCash deposit did not | Card only, everywhere |
| B11 | With Driver client copy "valid until" pulled a wrong date | Computed from issued_at |

## 7. Golden test cases (must pass exactly)

Put these in `src/lib/pricing/*.test.ts`. All repeat clients unless stated; cash; no promo; no CDW for Self-Drive unless stated.

**SD-1** (matches old sheet): MPV primo, 24h, 1 day, delivery 365, pickup 365, distance 0.
Lines: rental 2,630; carwash 250; delivery 365; pickup 365 → **subtotal 3,610**, total 3,610. Same case paid by card: terminal fee 126.35 → 3,736.35.

**SD-2** (real booking pattern, anonymised): Compact, 24h, 1 day, **new client**, delivery 490, no pickup, distance 0, reservation fee 500, deposit 2,000.
Rental 1,580; carwash 200; delivery 490 → subtotal 2,270; new-client discount −79 → **rental total 2,191**. Total contract value 4,191. Reservation 500 + delivery 490 = 990 today. **Balance on release 3,201.**

**SD-3** (fixes B1, B3): Sedan primo, 24h, 2 days, with CDW, one-way 200 km, gasoline 94, includeFuel.
Rental 3,780; CDW 700; carwash 200; fuel 400 ÷ 10 × 94 = 3,760; excess (400 − 300) × 4 = 400 → **subtotal 8,840**.

**SD-4** (fix B2): Compact, 24h, 5 days, APRIL_TIERED. Rental 7,900; carwash 200; promo −1,185 → **total 6,915**. Same with 4 days: rental 6,320; promo −632 → total 5,888.

**SD-5**: Compact, 24h, 7 days, sevenDayDiscount. Rental (1,580 − 100) × 7 = 10,360; carwash 200 → **total 10,560**.

**SD-6**: MPV primo, 24h, 1 day, extension 2h. Rental 2,630; carwash 250; extension 700 → **total 3,580**.

**WD-1** (matches old sheet 7,100): SUV primo, 08:30–18:30 (10h), 1 day, one-way 50 km, all_in, back_and_forth, round_trip, davao_region, regular, individual, meal 100, diesel 98.
Rental 3,580; CDW 500; carwash 300; driver's fee 750; meal 100; fuel 50 × 2.2 ÷ 8 × 98 = 1,347.50; excess 0; night diff 0 → lines 6,577.50; rounding 22.50; service fee 500 → **subtotal 7,100**.

**WD-2** (fix B6): Sedan primo, 24h, 3 days, one-way 120 km, all_in, long_term_parking, davao_region, regular, meal 300/day, gasoline 89.
Rental 1,890 × 3 = 5,670; CDW 1,050; carwash 200; driver first day 1,500; standby (1,500 − 500) × 1 = 1,000; last day 1,500; meal 900; fuel 120 × 2.2 ÷ 10 × 89 = 2,349.60; excess 0 → lines 14,169.60; rounding 30.40; service fee 500 → **subtotal 14,700**.

**WD-3**: Sedan primo, 8h, 1 day, pickup_dropoff, working_hour, one-way 15 km, all_in, gasoline 89.
Rental 1,100; CDW 350; carwash 200; driver's fee 200; fuel 15 × 2.2 ÷ 10 × 89 = 293.70 → lines 2,143.70; rounding 56.30; service fee 500 → **subtotal 2,700**.

**WD-4** (fix B6): same as WD-2 but 1 day → driver first day only (1,500), no standby, no last day.

**WD-5** corporate: WD-1 with corporate 10% → grand total 7,100 + 710 = **7,810**.
