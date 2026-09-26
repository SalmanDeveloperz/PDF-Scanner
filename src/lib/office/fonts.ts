import carlitoCss from "@fontsource/carlito/index.css?inline";
import carlitoItalicCss from "@fontsource/carlito/400-italic.css?inline";
import carlitoBoldCss from "@fontsource/carlito/700.css?inline";
import carlitoBoldItalicCss from "@fontsource/carlito/700-italic.css?inline";
import caladeaCss from "@fontsource/caladea/index.css?inline";
import caladeaItalicCss from "@fontsource/caladea/400-italic.css?inline";
import caladeaBoldCss from "@fontsource/caladea/700.css?inline";
import caladeaBoldItalicCss from "@fontsource/caladea/700-italic.css?inline";

/**
 * Office documents usually reference Microsoft fonts. Where the viewer has the
 * real font installed it is used through `local()`. Otherwise the metric-compatible
 * open fonts Carlito (for Calibri) and Caladea (for Cambria) keep line breaks and
 * pagination close to Office.
 */
const SANS_ALIASES = [
  "Calibri",
  "Calibri Light",
  "Aptos",
  "Aptos Display",
  "Aptos Narrow",
  "Aptos Light",
  "Segoe UI",
  "Candara",
  "Corbel",
];
const SERIF_ALIASES = ["Cambria", "Constantia", "Aptos Serif"];

const SERIF_PATTERN =
  /(serif|times|cambria|georgia|garamond|book antiqua|roman|constantia|palatino|minion|baskerville|bodoni|century schoolbook|didot|caladea|mincho|song)/i;
const MONO_PATTERN = /(mono|courier|consolas|menlo|lucida console|code)/i;

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function stripQuotes(value: string) {
  return value.trim().replace(/^['"]|['"]$/g, "");
}

function splitFamilies(value: string) {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of value) {
    if (char === "(") depth++;
    if (char === ")") depth = Math.max(0, depth - 1);
    if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else current += char;
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter(Boolean);
}

/** Builds a fallback-safe font-family list for an Office font name. */
export function officeFontStack(value: string | undefined | null) {
  const tokens = splitFamilies(value ?? "").filter(
    (name) => !/^(inherit|initial|unset)$/i.test(name),
  );
  const names = tokens.map((token) => (/var\(/i.test(token) ? token : stripQuotes(token)));
  const primary = names.find((name) => !/var\(/i.test(name)) ?? "Calibri";
  const generic = MONO_PATTERN.test(primary)
    ? ["Consolas", "Courier New", "monospace"]
    : SERIF_PATTERN.test(primary) && !/sans/i.test(primary)
      ? ["Cambria", "Caladea", "Times New Roman", "serif"]
      : ["Calibri", "Carlito", "Arial", "sans-serif"];
  return unique([...names, ...generic])
    .map((name) =>
      /^(serif|sans-serif|monospace)$/.test(name) || /var\(/i.test(name)
        ? name
        : `"${name.replace(/"/g, "")}"`,
    )
    .join(", ");
}

/** Adds fallbacks to every `font-family` declaration inside CSS text (not @font-face descriptors). */
export function withFontFallbacks(cssText: string) {
  return cssText
    .split(/(@font-face\s*{[^}]*})/g)
    .map((part) =>
      /^@font-face/.test(part)
        ? part
        : part.replace(/font-family\s*:\s*([^;}{]+)/gi, (_match, family: string) => {
            const important = /!important/i.test(family);
            const clean = family.replace(/!important/i, "").trim();
            return `font-family: ${officeFontStack(clean)}${important ? " !important" : ""}`;
          }),
    )
    .join("");
}

function aliasFaces(css: string, from: string, aliases: string[]) {
  const blocks = css.match(/@font-face\s*{[^}]*}/g) ?? [];
  const out: string[] = [];
  for (const alias of aliases) {
    for (const block of blocks) {
      const weight = /font-weight:\s*(\d+)/.exec(block)?.[1] ?? "400";
      const italic = /font-style:\s*italic/.test(block);
      const suffix =
        weight === "700" ? (italic ? " Bold Italic" : " Bold") : italic ? " Italic" : "";
      const locals = unique([
        `${alias}${suffix}`,
        `${alias.replace(/\s+/g, "")}${suffix ? `-${suffix.trim().replace(/\s+/g, "")}` : ""}`,
      ])
        .map((name) => `local("${name}")`)
        .join(", ");
      out.push(
        block
          .replace(new RegExp(`font-family:\\s*'${from}'`), `font-family: '${alias}'`)
          .replace(/src:\s*/, `src: ${locals}, `)
          .replace(/font-display:\s*swap;?/, "font-display: block;"),
      );
    }
  }
  return out.join("\n");
}

let cachedCss: string | null = null;

/** CSS for isolated render documents: open fonts plus Office-name aliases. */
export function officeFontCss() {
  if (cachedCss) return cachedCss;
  const carlito = [carlitoCss, carlitoItalicCss, carlitoBoldCss, carlitoBoldItalicCss].join("\n");
  const caladea = [caladeaCss, caladeaItalicCss, caladeaBoldCss, caladeaBoldItalicCss].join("\n");
  cachedCss = [
    carlito.replace(/font-display:\s*swap;?/g, "font-display: block;"),
    caladea.replace(/font-display:\s*swap;?/g, "font-display: block;"),
    aliasFaces(carlito, "Carlito", SANS_ALIASES),
    aliasFaces(caladea, "Caladea", SERIF_ALIASES),
  ].join("\n");
  return cachedCss;
}
