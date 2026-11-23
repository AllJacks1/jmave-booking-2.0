# Rework CRM lead webhook

Every client intake becomes a lead in Rework.

## 1. Endpoint

```
POST {REWORK_WEBHOOK_URL}?token={REWORK_WEBHOOK_TOKEN}
REWORK_WEBHOOK_URL = https://webhooks.rework.com/leads/source/leadgen
Content-Type: application/json
```

- `token` is required, unique per lead source, and identifies the source. It is a **URL parameter**.
- **Never log the full URL.** Build the URL in one helper; every log line, error message, outbox record and Sentry event must use a redacted form (`?token=***`).
- Both values are env vars only. The settings page shows "URL set / Token set: yes/no" and a "Send test lead" button (Super Admin). Never show the token value.

## 2. When a lead is sent

| Trigger | Condition |
|---|---|
| Public booking page submission (`inquiries`) | Always |
| Formal quotation issued for a **new** client (created in this flow) | Only if setting `rework_send_staff_intakes` is on (default on) |
| Manual "Send to Rework" on a client | Sales+ |

Each send is an `outbox` row (`kind = rework_lead`). The worker posts it, retries with exponential backoff (max 8 attempts), stores HTTP status + response body (truncated to 2 KB) and marks `sent`/`failed`. A client stores `rework_sent_at` so one intake is not sent twice. Settings shows the last 50 deliveries.

## 3. Field mapping

Rework's documented parameters (from the owner). Send only non-empty values.

| Rework field | Type | Source |
|---|---|---|
| `name` | text | client full name |
| `email` | text | client email |
| `phone` | phone | client phone, E.164 (`+639…`) |
| `title` | text | (not used) |
| `owner_id` | id | consultant's `user.rework_owner_id` if set |
| `labels` | list | `["Self-Drive"]` or `["With Driver"]`, plus the QTN number once issued |
| `stage`, `status`, `followers`, `campaign_ids`, `segments`, `collections`, `user_id`, `anonymous_id` | — | not sent (Rework defaults) |
| `custom_full_name` | text | client full name |
| `custom_email_address` | text | client email |
| `custom_phone_number` | phone | client phone, E.164 |
| `custom_birthday` | int | birthday → Unix timestamp (see §4) |
| `custom_start_time` | int | start_at → Unix timestamp |
| `custom_expected_return_date_time` | int | end_at → Unix timestamp |
| `custom_services` | string (option) | service → option value (see §4) |
| `custom_car_type` | string (option) | body type / category → option value |
| `custom_destination` | text | destination |
| `custom_full_itinerary_route_plan` | text | itinerary (With Driver) |
| `custom_delivery_address` | text | delivery address |
| `custom_pick_up_address` | text | pick-up address |
| `custom_drop_off_address` | text | drop-off address (With Driver) |
| `custom_alternative_contact_person` | text | `"<alt name> – <alt phone>"` (no separate number field) |
| `custom_drivers_license_no_` | text | driver's license no. |
| `custom_drivers_license` | string (option) | e.g. Professional / Non-professional, if collected |
| `custom_government_id` | string (option) | IDs presented |
| `custom_number_of_passengers` | int | passengers (With Driver) |
| `custom_number_of_luggages_if_any` | text | luggage (With Driver) |
| `custom_do_you_need_the_driver_to_waitstandby` | string (option) | Yes/No from driving term (long-term parking = Yes) |
| `custom_company_name_if_applicable` | text | company name (corporate) |
| `custom_special_requests` | text | special requests / notes |
| `custom_mode_of_payment` | string (option) | preferred payment method |
| `custom_deal_sources` | string (option) | `Website Booking Page` for public form; booking source channel for staff intakes |
| `custom_form_submission_link` | text | staff URL of the inquiry or quotation in our system |
| `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content` | text | from the public page URL (captured on first visit, kept in session storage) |
| `fbclid`, `gclid`, `ttclid` | text | from URL |
| `fbp` | text | `_fbp` cookie if present |
| `referral_url`, `referral_domain` | text | `document.referrer` at first visit |
| `geo_ip` | text | client IP from the request (`x-forwarded-for` first hop on Railway) |
| `user_agent` | text | request user agent |
| Meta/Google/LinkedIn/TikTok ad IDs | text | only if present as URL params with the same names |

## 4. Unknowns to settle in Phase 4 (ask the owner, then test)

1. **Option values.** Fields typed "string" (`custom_services`, `custom_car_type`, `custom_mode_of_payment`, `custom_deal_sources`, `custom_government_id`, `custom_drivers_license`, `custom_do_you_need_the_driver_to_waitstandby`) are probably dropdowns in Rework. Values must match exactly. Store the mapping in settings (`rework_option_map`, editable by Super Admin) so it can change without a deploy.
2. **`int` date fields.** Probably Unix seconds. Make the unit a setting (`seconds` | `milliseconds`), default seconds, and confirm by sending one test lead and checking it in Rework.
3. **Response format.** Record whatever Rework returns. Treat any 2xx as success.
