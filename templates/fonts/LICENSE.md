# Font licences

The two `.woff2` files in this folder are embedded as base64 `@font-face`
blocks in the rendered card HTML (docs/ARCHITECTURE.md section 6). They are
subsets served by Google Fonts and were downloaded by `tools/fetch-fonts.sh`
from:

```
https://fonts.googleapis.com/css2?family=Inter:wght@400;700&family=Noto+Kufi+Arabic:wght@400;700&display=swap
```

| File | Family | Weights | Subset | Copyright |
|---|---|---|---|---|
| `inter.woff2` | Inter | variable, 400 to 700 used | latin | Copyright 2016 The Inter Project Authors (https://github.com/rsms/inter) |
| `noto-kufi-arabic.woff2` | Noto Kufi Arabic | variable, 400 to 700 used | arabic | Copyright 2022 The Noto Project Authors (https://github.com/notofonts/arabic) |

Both families are licensed under the **SIL Open Font License, Version 1.1**
(https://openfontlicense.org). The OFL permits bundling and embedding the
fonts in documents and web pages, including the base64 embedding used here,
as long as the fonts themselves are not sold on their own and the Reserved
Font Names are not used for modified versions. No glyphs are modified; the
files are the unmodified subsets Google Fonts serves.

Google Fonts serves both families as variable fonts (one file carrying the
`wght` axis), which is why there is one file per family: `src/render/fonts.ts`
declares each with `font-weight: 400 700` and Chromium picks the instance.
The download script stops if Google ever returns separate static files for
the two weights, since the module would then need one `@font-face` per weight.

If the approved design (docs/DESIGN-HANDOFF.md) uses other faces, add them
here with the same information and update `src/render/fonts.ts`.
