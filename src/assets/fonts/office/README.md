# Office-compatible fonts for vector PDF text

These fonts are used by the Word/Excel/PowerPoint to PDF converters to write
real (vector, selectable) text into generated PDFs. They are metric-compatible
with common Microsoft Office fonts, so text drawn with them lands exactly where
the browser laid it out:

| File | Metric-compatible with |
| --- | --- |
| Carlito-* | Calibri |
| Caladea-* | Cambria |
| LiberationSans-* | Arial, Helvetica |
| LiberationSerif-* | Times New Roman |
| LiberationMono-* | Courier New |

Hinting and OpenType layout tables were removed with `pyftsubset --no-hinting --layout-features=""` to reduce size and avoid ligature substitution; glyph coverage is unchanged.

- Carlito — Copyright (c) 2010-2013 tyPoland Lukasz Dziedzic, Reserved Font Name "Carlito".
- Caladea — Copyright (c) 2012 Carolina Giovagnoli, Andres Torresi and Huerta Tipografica.
- Liberation — Digitized data copyright (c) 2010 Google Corporation; Copyright (c) 2012 Red Hat, Inc., Reserved Font Name "Liberation".

All are licensed under the SIL Open Font License 1.1 (see `OFL.txt`).
