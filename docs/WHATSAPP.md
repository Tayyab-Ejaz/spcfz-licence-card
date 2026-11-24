# The welcome WhatsApp message

19 November 2026. SPC sends WhatsApp through **Gallabox**. When a licence card is created with the customer's
mobile number, the customer gets one WhatsApp message beside the welcome email: their card picture, a short
congratulation and an **Open my card** button that opens their studio.

**English only** (SPC, 24 November 2026): every customer gets the English message, whatever their preferred
language. The welcome email still follows the customer's language.

## How it works

- **Trigger:** the same moments as the welcome email (src/intake/accept.ts). That covers the ERP webhook,
  Admin → Create, CSV import (when ticked) and Admin → Test flow. Each card gets the message once. Staff can
  press **Send it again** on the card page.
- **The number** comes from the ERP (`customer_mobile`, `mobile`, `phone`, `whatsapp`… or inside the owner object;
  see docs/ERP-WEBHOOK.md), or from staff. UAE numbers are accepted in any common form (050 123 4567,
  +971 50…, 00971…); other countries need their code (+91…). Numbers are stored as +971501234567. Only mobile
  numbers are kept.
  - From the ERP, a number we cannot read does not stop the card. The ERP's answer lists it under `notes`, and no
    message is sent.
  - In the admin, the same number is refused so staff can fix the typo.
- **When:** messages the ERP triggers go out between 09:00 and 21:00 Dubai time. Ones that arrive at night wait for
  09:00. Staff actions go out at once.
- **Retries:** if Gallabox is unreachable or refuses, the service tries again after 1, 5, 30, 120 and 720 minutes,
  then marks the message failed. The reason is on the card page.
- **Delivery:** after Gallabox accepts a message, the service reads back what WhatsApp says: sent, delivered,
  read, or not delivered with the reason (for example "not on WhatsApp"). It checks at 2 min, 15 min, 1 h, 6 h,
  24 h and 3 days, and stops once the message is read or failed. This needs `GALLABOX_ACCOUNT_ID`.
- **Replies** go to Gallabox's inbox on the same number, where SPC's team already works. The licence-card
  service never sees them.
- **Stopping:** the card page has **Stop WhatsApp to this number**. Use it when a customer asks, or when the
  number belongs to someone else. **Allow WhatsApp again** undoes it.
- **Test cards** only message the numbers in Admin → Settings → WhatsApp test numbers.
- **Counted:** the button's link ends in `?via=whatsapp`, so the admin and the monthly report count visits from
  WhatsApp separately from visits from the email.
- **Local copy:** `WHATSAPP_TRANSPORT=file` writes each message to `DATA_DIR/whatsapp-outbox`: a `.txt` as the
  customer would read it, and the Gallabox request as `.json`. Nothing is sent.

## The template (create it in Gallabox)

WhatsApp only lets a business start a chat with a template Meta has approved. The words live in Gallabox; the
service sends the template's name and fills in its blanks. Create one template, in English:

| Part | `licence_card_welcome` |
|---|---|
| Category | Utility |
| Language | English |
| Header | Image (for the sample, any card picture) |
| Body | see below |
| Footer | SPC Free Zone |
| Button | Visit website, "Open my card", dynamic URL `https://licensed.spcfz.ae/c/{{1}}` |

Body (Claude's draft, made from SPC's welcome email copy):

```
Hi {{name}}, congratulations! {{company}} is officially licensed at SPC Free Zone.

We’ve built a personalised announcement card to help you break the news. Add your photo, then share it on LinkedIn or download it.
```

What the service fills in:

- `{{name}}` is the founder's first name (English). Without one it is "there" ("Hi there,").
- `{{company}}` is the company's English name.
- The button's `{{1}}` is the customer's own part of the link, `<token>?lang=en&via=whatsapp`.
- The image is the same card picture the welcome email shows (`/c/<token>/card/…jpg`).

The admin's **Preview** button shows the message with these words. If SPC changes the words in Gallabox, change
`TEMPLATE_TEXT` in src/whatsapp/message.ts too, so the preview stays true.

Notes for whoever creates the template:

- **Name the variables `name` and `company`.** If Gallabox only offers numbered variables ({{1}}, {{2}}), use
  {{1}} for the name and {{2}} for the company and tell the developer. It is a one-line change in
  `welcomeWhatsapp` (src/whatsapp/message.ts).
- **Utility, not Marketing.** Meta decides the category from the wording. Marketing costs about three times as
  much, and Meta limits how many marketing messages each person receives, so some would not arrive. Keep the
  wording about the licence and the card. If Meta files it as Marketing anyway, it still works.
- **The template name** is free to choose. If it is not `licence_card_welcome`, set `WHATSAPP_TEMPLATE_EN`.
- **No image header?** Set `WHATSAPP_HEADER=none`.

## Turn it on (production)

Each server write below needs the owner's yes at the time (CLAUDE.md). The secrets are typed by the owner, never
by Claude.

1. In Gallabox, create an API key (Settings → API keys, app.gallabox.com/apikey) and copy the key and the
   secret. Give it only the permissions the service uses (Gallabox asks for them when the key is made):
   - **send WhatsApp messages**: `POST /devapi/messages/whatsapp`, the template message;
   - **read messages / message status**: `GET /devapi/accounts/<account id>/messages/<id>/status`, whether it was
     delivered and read.

   Nothing else: no contacts, users, conversations, templates, webhooks or billing. Also copy the **channel id**
   of the marketing team's WhatsApp number and the **account id** (each in its own settings page, with a Copy
   button).
2. Create the template above and get it approved.
3. Add to `/opt/spcfz-licence-card/licence-card.env`, typing the secret yourself:

   ```
   WHATSAPP_TRANSPORT=gallabox
   GALLABOX_API_KEY=<api key>
   GALLABOX_API_SECRET=<api secret>
   GALLABOX_CHANNEL_ID=<channel id>
   GALLABOX_ACCOUNT_ID=<account id>
   WHATSAPP_TEMPLATE_EN=licence_card_welcome
   ```

4. Recreate the container (docs/RUNBOOK.md, Secrets). The service refuses to start if the key, secret or channel
   is missing, and logs `mail {"transport":"smtp","whatsapp":"gallabox"}` when it is on.
5. Admin → Settings → WhatsApp test numbers: add your own number.
6. Admin → Test flow → Typical licence → Send as the ERP. Step 4 on the run page follows the message: sent, then
   delivered and read. Check it on the phone: the card picture shows, and Open my card opens the card.

To switch it off again: `WHATSAPP_TRANSPORT=off` and recreate the container. Messages stay queued in the admin.

## Before real customers get it

- **Consent.** Meta requires that a customer agreed to hear from SPC on WhatsApp. SPC agreed to this on
  24 November 2026 and covers it on its side; the service does not check it.
- **The ERP field.** The mobile number comes from the ERP (SPC, 24 November 2026; docs/ERP-WEBHOOK.md,
  version 0.3). Until the ERP sends it, only cards staff create with a mobile get the message.

## Troubleshooting

| On the card page | Meaning |
|---|---|
| failed, "Gallabox answered 401" | Wrong API key or secret. |
| failed, "Gallabox answered 400: …template…" | The template name is wrong or not approved yet, or its variables differ from `name` / `company`. |
| sent, then "not delivered: … (131026)" | The number is not on WhatsApp, or cannot receive it. |
| sent, then "not delivered: … (131049)" | Meta held back a marketing message; see "Utility, not Marketing". |
| sent, "accepted by Gallabox" and nothing more | `GALLABOX_ACCOUNT_ID` is not set, so delivery is not read back. |
| skipped, "test card: …" | Add the number to Admin → Settings → WhatsApp test numbers. |
| queued, "goes at 09:00" | The ERP sent it at night; it waits for Dubai morning. |
