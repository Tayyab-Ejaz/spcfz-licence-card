# The welcome WhatsApp message

19 November 2026. SPC sends WhatsApp through **Gallabox**. When a licence card is created with the customer's
mobile number, the customer gets one WhatsApp message beside the welcome email: their own card picture, a short
congratulation with the link to their studio, and a **View My Post** button that opens it too.

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
- **Counted:** the message's link and its button end in `?via=whatsapp`, so the admin and the monthly report count visits from
  WhatsApp separately from visits from the email.
- **Local copy:** `WHATSAPP_TRANSPORT=file` writes each message to `DATA_DIR/whatsapp-outbox`: a `.txt` as the
  customer would read it, and the Gallabox request as `.json`. Nothing is sent.

## The template (approved in Gallabox)

WhatsApp only lets a business start a chat with a template Meta has approved. The words live in Gallabox; the
service sends the template's name and fills in its blanks. SPC's approved template, read back from Gallabox's API
on 24 November 2026 (Gallabox id `6b057a72fa6579f26637877e`):

| Part | `24112026_linkedin_milestone` |
|---|---|
| Category | Marketing |
| Language | English |
| Channel | SPC Free Zone- Marketing |
| Header | Image: the customer's own card picture, in the Day One style (Meta's sample was test card TEST-REF-261124-9368's Daylight picture) |
| Body | below, with one variable, `{{variable_1}}` |
| Footer | none |
| Button | Visit website, "View My Post", dynamic URL `https://licensed.spcfz.ae/c/{{1}}` |

```
*You're Officially A Business Owner: Let Everyone Know!*
Congratulations on starting your business!

We've made a personalised announcement card to help you share the news with your network. Want to try a different design or make changes to the content? Click the link below: {{variable_1}}

Welcome to the SPC Free Zone family! We wish you success in the years to come.
```

What the service fills in:

- `{{variable_1}}` is the customer's studio link, `https://licensed.spcfz.ae/c/<token>?lang=en&via=whatsapp`.
- The button's `{{1}}` is the same link's part after `/c/`, `<token>?lang=en&via=whatsapp`.
- The header picture is the customer's card in the **Day One** style (SPC, 25 November 2026): the tear-off
  calendar of the licence date, "I've started a new business!", the company and activity, the founder's initials
  and name, and "Licensed with" SPC. `https://licensed.spcfz.ae/c/<token>/card/<hash>-v<n>-dayone.jpg`, a
  1080 × 1080 JPEG of about 65 KB (WhatsApp's limit is 5 MB), drawn from the ERP's details. The welcome email keeps
  the Daylight picture (the same address without `-dayone`).

In Gallabox's request that is `headerValues: { mediaUrl, mediaName }`, `bodyValues: { variable_1: <link> }` and
one URL `buttonValues` entry.

The earlier template `19112026_linkedin_milestone` (Gallabox id `6afe9a1555cdaaae78f0acd7`) is the same without the
header. To use it: `WHATSAPP_TEMPLATE_EN=19112026_linkedin_milestone` and `WHATSAPP_HEADER=none`. The first real
send (24 November 2026, to SPC's own phone, test card TEST-REF-261124-9368) used it and was **delivered**.

The admin's **Preview** button shows the message with these words. They are copied into `TEMPLATE_TEXT` in
src/whatsapp/message.ts; if SPC changes the template in Gallabox, change that too, so the preview stays true.

Notes:

- **A new template needs a code change if its variables differ.** Gallabox refuses a send whose values do not
  match the template, so a new variable, a different variable name or a header means changing `welcomeWhatsapp`
  (src/whatsapp/message.ts). A new template with the same shape only needs `WHATSAPP_TEMPLATE_EN`.
- **Marketing, not Utility.** Meta filed this template as Marketing. Marketing costs more per message (Gallabox
  shows new UAE rates), and Meta limits how many marketing messages each person receives, so some welcomes may
  not arrive (error 131049 in the table below). A Utility template, worded about the licence and the card, would
  avoid both; that is SPC's call.
- **The picture must match the template.** `WHATSAPP_HEADER=image` (the default) for a template with an image
  header, `none` for one without; Gallabox refuses a send that does not match.

## Turn it on (production)

Each server write below needs the owner's yes at the time (CLAUDE.md). The secrets are typed by the owner, never
by Claude.

1. In Gallabox, create an API key (Settings → API keys, app.gallabox.com/apikey) and copy the key and the
   secret. Gallabox lists the key's permissions as checkboxes in groups, each with `read`, `readMany`, `export`,
   `view`, `manage`, `create`, `update`, `delete`, `createMany`, `import` and restrictions named `not-…`. The
   service makes two calls: `POST /devapi/messages/whatsapp` (the template message) and
   `GET /devapi/accounts/<account id>/messages/<id>/status` (whether it was delivered and read). Tick:
   - **Message: `read`**: without it the status call answers 403 "Don't have access to read Message" (seen
     24 November 2026);
   - **Message: `create`**: for sending (Gallabox checks the request before the permission, so this was not
     provable without a real send);
   - **Contact: `read`, `create`, `update`**: sending to a new number makes a contact in Gallabox;
   - **none of the `not-…` boxes.** They take abilities away: `not-send-whatsapp-template` would stop the very
     message this service sends, and `not-trigger-bot` could change how a bot on the marketing number behaves.

   If the first test send answers 401 or 403, the key is missing a permission: add the one Gallabox names, never
   `manage`, `delete`, `export` or `import`.

   Also copy the **channel id** of the marketing team's WhatsApp number and the **account id** (each in its own
   settings page, with a Copy button).
2. Create the template above and get it approved.
3. Add to `/opt/spcfz-licence-card/licence-card.env`, typing the secret yourself:

   ```
   WHATSAPP_TRANSPORT=gallabox
   GALLABOX_API_KEY=<api key>
   GALLABOX_API_SECRET=<api secret>
   GALLABOX_CHANNEL_ID=<channel id>
   GALLABOX_ACCOUNT_ID=<account id>
   ```

   `WHATSAPP_TEMPLATE_EN` is only needed for a template other than `24112026_linkedin_milestone`.

4. Recreate the container (docs/RUNBOOK.md, Secrets). The service refuses to start if the key, secret or channel
   is missing, and logs `mail {"transport":"smtp","whatsapp":"gallabox"}` when it is on.
5. Admin → Settings → WhatsApp test numbers: add your own number.
6. Admin → Test flow → Typical licence → Send as the ERP. Step 4 on the run page follows the message: sent, then
   delivered and read. Check it on the phone: the card picture shows, and the link in the text and the View My Post button both open the card.

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
| failed, "Gallabox answered 400/422: …template…" | The template name is wrong or not approved yet, or its variables differ from `variable_1` and the one URL button. |
| sent, then "not delivered: … (131026)" | The number is not on WhatsApp, or cannot receive it. |
| sent, then "not delivered: … (131049)" | Meta held back a marketing message; see "Marketing, not Utility". |
| sent, "accepted by Gallabox" and nothing more | `GALLABOX_ACCOUNT_ID` is not set, so delivery is not read back. |
| skipped, "test card: …" | Add the number to Admin → Settings → WhatsApp test numbers. |
| queued, "goes at 09:00" | The ERP sent it at night; it waits for Dubai morning. |
