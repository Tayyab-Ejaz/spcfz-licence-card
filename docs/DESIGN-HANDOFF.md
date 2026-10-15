# Design handoff: what the card design must contain

Version 0.1, 15 October 2026. For the designer producing the "officially
licensed at SPC Free Zone" social creative. The design is turned into an HTML
template that a browser renders to PNG, so everything below is about making
that translation exact.

## Sizes

| Name | Pixels | Where it is posted |
|---|---|---|
| Square | 1080 x 1080 | Instagram feed, LinkedIn, Facebook |
| Portrait | 1080 x 1350 | Instagram feed |
| Story | 1080 x 1920 | Instagram and Facebook stories, WhatsApp status |
| Landscape | 1200 x 628 | LinkedIn, Facebook and X link posts, and the preview image of the personal page |

Each size in English and in Arabic: eight layouts in total. If the Arabic
version is a mirrored right-to-left copy of the English one, say so and
deliver four, with one mirrored example so we can see the intended result.

Story safe zone: keep text and logo out of the top 250 px and the bottom 250 px,
where Instagram and WhatsApp place their own controls.

## Variable content

These change per customer and must have a clearly marked zone with a
maximum size, an alignment and a wrapping rule:

| Variable | Example, English | Example, Arabic | Notes |
|---|---|---|---|
| Company name | Nimbus Publishing FZE | نيمبوس للنشر م.م.ح | Show the zone with a 12-character and a 60-character name in each script. Say whether a long name shrinks, wraps to two lines, or both. If no Arabic name exists, the English name sits in this zone on the Arabic card. |
| Licence number | SPC-2026-01234 | SPC-2026-01234 | Always Latin digits. |
| Activity category | Publishing | النشر | Up to about 40 characters. May be empty; show the layout without it. |
| Issue date | October 2026 | أكتوبر 2026 | Month and year only. |

## Fixed content

- SPC Free Zone logo, in the variant and minimum size the brand allows.
- The headline. Working copy: "We're officially licensed at SPC Free Zone" and
  its Arabic equivalent. Final wording is yours.
- Website: spcfz.ae.
- A reserved square of at least 180 x 180 px, on the 1080-wide sizes, for a
  QR code that arrives in a later phase. It can be empty or carry a decorative
  element in version one, but the space must exist.

## Brand

Current tokens from the SPC Free Zone design system:

```
Blue #004dff   Blue 2 #102ea2   Cyan #00b2c7
Ink  #071329   Muted  #53617c   Border #dfe7f4
Gold #f0b429   Green  #19a567   Pink   #e84d88
```

Type: Inter for Latin, Noto Kufi Arabic for Arabic. If the design uses other
faces, see the font requirement below.

## Deliverables

1. **A Figma or Claude Design link** with the eight layouts, or four plus a
   mirrored example, with text zones named.
2. **One PNG per layout at exact pixel size**, with the example content
   above, used as the reference for a pixel comparison during testing.
3. **Font files** for every face used, in WOFF2 or TTF, with confirmation that
   the licence allows embedding in a web page. The renderer has no system
   fonts, so every face is embedded.
4. **Any imagery** such as backgrounds or patterns as SVG or PNG at 2x.
5. **Text rules**: the maximum and minimum font size for the company name,
   the maximum number of lines, and what happens when a name still does not
   fit.

## Things to avoid

- Text inside raster images. All text must be live so it can change language.
- Effects a browser cannot reproduce exactly, such as some blend modes and
  mesh gradients. Flat colour, standard gradients and drop shadows are fine.
- Relying on exact Arabic letterforms from a font we cannot embed.
