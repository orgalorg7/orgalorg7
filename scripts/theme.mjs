// Light-mode support: remap dark presentation colors when the viewer prefers a light theme.
// `scope` limits the remap (e.g. "svg > " keeps illustrated panels untouched).
export function lightModeCss(colors, { scope = "", extra = "" } = {}) {
  const rules = Object.entries(colors).map(([dark, light]) =>
    `${scope}[fill="${dark}"]{fill:${light}}${scope}[stroke="${dark}"]{stroke:${light}}`
  ).join("");
  return `@media (prefers-color-scheme: light){${rules}${extra}}`;
}

// GitHub's light palette, keyed by the dark colors the renderers use.
export const lightPage = "#ffffff";
export const lightInk = "#1f2328";
export const lightMuted = "#59636e";
export const lightLine = "#d1d9e0";
