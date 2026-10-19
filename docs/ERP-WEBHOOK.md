# Licence-issued webhook: specification for the ERP team

From SPC Free Zone marketing. Version 0.1, 15 October 2026.

When a business licence is issued, please send us one HTTP request. We answer
with a web address. That address goes into the licence-issued email you already
send to the customer. Nothing else is needed from the ERP.

## Endpoints

| Use | URL |
|---|---|
| Testing, use this first | `https://licensed.spcfz.ae/v1/test/licence-issued` |
| Live licences | `https://licensed.spcfz.ae/v1/licence-issued` |

Method `POST`, HTTPS only, body in JSON, `Content-Type: application/json`.

Each endpoint has its own secret. We will hand both secrets over through a
channel you choose, never by email. The test secret never works on the live
endpoint and the other way round.

## Authentication

Send the secret in one of these two headers, whichever your system supports:

```
X-SPC-Webhook-Secret: <secret>
```
or
```
Authorization: Bearer <secret>
```

We also allow traffic only from your public IP addresses. Please send us the
list of addresses the ERP uses for outbound calls, and tell us before they
change.

## Payload

We adapt to your field names. Send what you have, using the names your system
already uses, and post a few examples to the test endpoint. We will map them on
our side. What we need:

| Information | Required | Notes |
|---|---|---|
| Licence number | yes | Exactly as printed on the licence. |
| Company name, English | yes | The legal name. |
| Company name, Arabic | no | Used when present. |
| Licence type | no | Free text as you hold it. |
| Business activity or activity category | no | One value, or a list; we use the first. |
| Business activity, Arabic | no | Shown on the Arabic card. Send it as its own field, or inside the activity object next to the English name (for example `Description_EN` and `Description_AR`). Without it the Arabic card shows the English activity. |
| Founder's name, English | no | Pre-filled on the card; the customer can change it. A plain field, or the name inside an owner or founder object. |
| Founder's name, Arabic | no | Used on the Arabic card. Without it the Arabic card shows the English name. |
| Issue date | no | Any unambiguous format. ISO `YYYY-MM-DD` is best. Defaults to today. |
| Licence expiry date | strongly recommended | The licence's last valid day, any unambiguous format (for example `expiry_date`). After this day the card's page says the licence has expired. Send the licence again with the new date when it is renewed, and the same link works again. Without it the card never expires. |
| Customer's preferred language | no | `en` or `ar`. Defaults to English. |

The founder's name is the only personal detail we keep. Please do not send
email addresses or phone numbers; if your system cannot leave them out, we
discard them on receipt and never store them.

Example:

```json
{
  "licence_number": "SPC-2026-01234",
  "company_name_en": "Nimbus Publishing FZE",
  "company_name_ar": "نيمبوس للنشر م.م.ح",
  "licence_type": "Standard",
  "activity_category": "Publishing",
  "activity_category_ar": "النشر",
  "founder_name": "Mariam Fawzy",
  "founder_name_ar": "مريم فوزي",
  "issued_on": "2026-10-15",
  "expiry_date": "2027-10-14",
  "preferred_language": "en"
}
```

Bodies over 64 KB are rejected.

## Response

Normally within one second:

```json
{
  "status": "accepted",
  "card_id": "01J9ZK4Q7W…",
  "page_url": "https://licensed.spcfz.ae/c/7Hk2bQpX9sLm3nVd8rTy1w",
  "ready": true
}
```

Put `page_url` into the customer's licence-issued email. The page is ready as
soon as we answer: the customer builds and downloads the card in the browser.

Sending the same licence twice is safe. You get the same `page_url` back.
A renewal is the same licence number with a later expiry date: send it the
same way, and the existing card comes back with the same `page_url`.
Sending the same licence with corrected details updates the card behind the
same address.

| Status | Meaning | What to do |
|---|---|---|
| 200 | Accepted, including repeats | Use `page_url`. |
| 400 | The body could not be read or a required field is missing | Response lists the problems. Fix and resend. |
| 401 | Wrong or missing secret | Check the header and which endpoint you called. |
| 403 | Your IP address is not on our list | Tell us the address. |
| 413 | Body too large | Send less. |
| 429 | Too many requests from an address that is not on our list | Should not happen from your listed addresses; tell us if it does. |
| 500 to 599 | Our fault | Resend later if you can. If your system cannot retry, nothing is lost: we can recreate the card from the licence number on our side. |

Set your request timeout to at least 10 seconds.

## Going live

1. We send you the two secrets. You send us your outbound IP addresses.
2. You post several real-looking licences to the test endpoint, including at
   least one with no Arabic name and one with a long company name.
3. We confirm the field mapping with you and show you the resulting pages.
4. You add `page_url` to the licence-issued email template.
5. You switch the URL to the live endpoint and the secret to the live secret.
6. The first few live licences are checked by both teams.

## Contact

SPC Free Zone marketing, marketing.admin@spcemail.co.
