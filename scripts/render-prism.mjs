import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lightInk, lightLine, lightModeCss, lightMuted, lightPage } from "./theme.mjs";

// A Dark Side of the Moon-style prism: one white beam (all public code) splits into a band per language.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const C = { page: "#0d1117", ink: "#ede8dd", muted: "#a4a39e", orange: "#ee956e", line: "#30363d", night: "#050608" };
const rainbow = ["#e8423f", "#f39c34", "#f6d743", "#4fc263", "#3b8eea", "#8e5bd8"];
const shortNames = { "Jupyter Notebook": "Jupyter" };
const xml = (s) => String(s ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

function text(s, x, y, size, { fill = C.ink, mono = false, weight = 400, spacing = 0, anchor = "start" } = {}) {
  return `<text x="${x}" y="${y}" font-size="${size}" class="${mono ? "mono" : "sans"}" fill="${fill}" font-weight="${weight}" letter-spacing="${spacing}" text-anchor="${anchor}">${xml(s)}</text>`;
}

// Languages under 1% fold into "Other" (dropped too if the remainder is still under 1%).
export function spectrumBands(languages, max = 6) {
  const entries = Object.entries(languages ?? {}).filter(([, bytes]) => bytes > 0).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((sum, [, bytes]) => sum + bytes, 0);
  if (!total) return [];
  const remainder = (shown) => (total - shown.reduce((sum, [, bytes]) => sum + bytes, 0)) / total;
  let shown = entries.filter(([, bytes]) => bytes / total >= 0.01).slice(0, max);
  if (remainder(shown) >= 0.01 && shown.length === max) shown = shown.slice(0, max - 1);
  const bands = shown.map(([name, bytes]) => ({ name: shortNames[name] ?? name, share: bytes / total }));
  if (remainder(shown) >= 0.01) bands.push({ name: "Other", share: remainder(shown) });
  return bands.map((band, i) => ({
    ...band,
    color: rainbow[bands.length === 1 ? 0 : Math.round(i * (rainbow.length - 1) / (bands.length - 1))]
  }));
}

const point = (p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

function prism(bands, { x, y, w, h }, { labels, id }) {
  const apex = { x: x + w * (labels ? 0.4 : 0.36), y: y + h * 0.1 };
  const baseY = y + h * 0.9;
  const half = (baseY - apex.y) * 0.62;
  const left = { x: apex.x - half, y: baseY };
  const right = { x: apex.x + half, y: baseY };
  const entry = lerp(apex, left, 0.55);
  const exit = lerp(apex, right, 0.48);
  const start = { x: x + 8, y: entry.y + h * 0.24 };
  const fanEnd = x + w - (labels ? 190 : 4);
  const spreadTop = y + h * 0.2;
  const spread = h * 0.74;
  const minShare = 0.07;
  const thickness = bands.map((band) => spread * (minShare + band.share * (1 - bands.length * minShare)));
  const beamLength = Math.hypot(entry.x - start.x, entry.y - start.y);
  const fanWidth = fanEnd - exit.x;

  let offset = 0;
  const rays = bands.map((band, i) => {
    const top = spreadTop + offset;
    const bottom = top + thickness[i];
    const exitTop = exit.y - 6 + (offset / spread) * 12;
    const exitBottom = exit.y - 6 + ((offset + thickness[i]) / spread) * 12;
    offset += thickness[i];
    const ray = `<path d="M${exit.x} ${exitTop.toFixed(1)}L${fanEnd} ${top.toFixed(1)}V${bottom.toFixed(1)}L${exit.x} ${exitBottom.toFixed(1)}Z" fill="${band.color}" class="shimmer" style="animation-delay:-${(i * 0.55).toFixed(2)}s"/>`;
    const middle = (top + bottom) / 2;
    const label = labels ? `${text(band.name, fanEnd + 18, middle + 5, 16, { fill: band.color, weight: 700 })}
    ${text(`${(band.share * 100).toFixed(band.share < 0.1 ? 1 : 0)}%`, x + w, middle + 5, 14, { mono: true, fill: C.muted, anchor: "end" })}` : "";
    return { ray, label };
  });

  return `<defs>
    <linearGradient id="${id}-glass" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity=".09"/><stop offset="1" stop-color="#ffffff" stop-opacity=".02"/>
    </linearGradient>
    <filter id="${id}-glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="5"/></filter>
    <clipPath id="${id}-fan"><rect x="${exit.x}" y="${y}" width="${fanWidth + (labels ? 200 : 6)}" height="${h}">
      <animate attributeName="width" values="0;0;${fanWidth + (labels ? 200 : 6)}" keyTimes="0;.5;1" dur="2.4s" fill="freeze"/>
    </rect></clipPath>
  </defs>
  <path d="M${point(start)}L${point(entry)}" stroke="#f0f6fc" stroke-width="3" stroke-linecap="round" class="ray-in" style="stroke-dasharray:${beamLength.toFixed(1)};stroke-dashoffset:${beamLength.toFixed(1)}"/>
  <path d="M${point(start)}L${point(entry)}" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-dasharray="2 22" class="photons"/>
  <path d="M${point(entry)}L${exit.x} ${exit.y - 6}V${exit.y + 6}Z" fill="#ffffff" opacity=".22" class="fade-late"/>
  <g clip-path="url(#${id}-fan)">
    ${rays.map((r) => r.ray).join("\n    ")}
    ${rays.map((r) => r.label).join("\n    ")}
  </g>
  <path d="M${point(apex)}L${point(left)}L${point(right)}Z" fill="none" stroke="#f0f6fc" stroke-width="5" filter="url(#${id}-glow)" class="pulse"/>
  <path d="M${point(apex)}L${point(left)}L${point(right)}Z" fill="url(#${id}-glass)" stroke="#f0f6fc" stroke-width="2.2" stroke-linejoin="round"/>
  <circle cx="${exit.x}" cy="${exit.y}" r="3" fill="#ffffff" class="twinkle"/>`;
}

function shell(width, height, description, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc">
<title id="title">The dark side of the code</title><desc id="desc">${xml(description)}</desc>
<style>
  .sans{font-family:Arial,Helvetica,sans-serif}.mono{font-family:"Liberation Mono",Consolas,monospace}
  .ray-in{animation:ray-in 1s ease-out .2s forwards}
  @keyframes ray-in{to{stroke-dashoffset:0}}
  .photons{opacity:0;animation:flow 1.1s linear infinite,fade .5s ease-out 1.1s forwards}
  @keyframes flow{to{stroke-dashoffset:-48}}
  @keyframes fade{to{opacity:.9}}
  .fade-late{opacity:0;animation:fade-inner .4s ease-out 1.1s forwards}
  @keyframes fade-inner{to{opacity:.22}}
  .shimmer{animation:shimmer 2.8s ease-in-out infinite alternate}
  @keyframes shimmer{from{opacity:.72}to{opacity:1}}
  .pulse{animation:pulse 3.2s ease-in-out infinite alternate}
  @keyframes pulse{from{opacity:.15}to{opacity:.6}}
  .twinkle{transform-box:fill-box;transform-origin:center;animation:twinkle 1.6s ease-in-out infinite alternate}
  @keyframes twinkle{from{opacity:.4;transform:scale(.6)}to{opacity:1;transform:scale(1.5)}}
  @media (prefers-reduced-motion:reduce){.ray-in,.photons,.fade-late,.shimmer,.pulse,.twinkle{animation:none}.ray-in{stroke-dashoffset:0}.photons{display:none}.fade-late{opacity:.22}}
  ${lightModeCss({ [C.page]: lightPage, [C.ink]: lightInk, [C.muted]: lightMuted, [C.line]: lightLine, [C.orange]: "#bc4c00" }, { scope: "svg > " })}
</style>
<rect width="${width}" height="${height}" rx="8" fill="${C.page}"/>
${body}
</svg>\n`;
}

function render(bands, repoCount, mobile) {
  const width = mobile ? 440 : 1200;
  const description = `Languages by bytes across ${repoCount} public repositories: ${bands.map((b) => `${b.name} ${(b.share * 100).toFixed(1)}%`).join(", ")}.`;
  const caption = `${repoCount} public repos · measured in bytes · refreshed nightly`;
  const header = `<path d="M16 1h${width - 32}" stroke="${C.line}"/>
${text("05 / SPECTRUM", 16, 34, mobile ? 13 : 12, { mono: true, fill: C.orange, spacing: 1.5 })}
${mobile ? "" : text("~/dark-side", width - 16, 33, 13, { mono: true, fill: C.muted, anchor: "end" })}
${text("The dark side of the code.", 14, mobile ? 92 : 100, mobile ? 30 : 56, { weight: 700, spacing: mobile ? -1 : -2.2 })}`;

  if (!mobile) {
    const panel = { x: 16, y: 128, w: width - 32, h: 340 };
    const body = `${header}
<g transform="translate(${panel.x} ${panel.y})"><rect width="${panel.w}" height="${panel.h}" rx="5" fill="${C.night}"/></g>
${prism(bands, { x: 44, y: panel.y + 20, w: width - 88, h: panel.h - 40 }, { labels: true, id: "p" })}
${text(caption, 16, panel.y + panel.h + 30, 12, { mono: true, fill: C.muted, spacing: 1 })}
${text("A beam of code. A spectrum of languages.", width - 16, panel.y + panel.h + 30, 14, { fill: C.muted, anchor: "end" })}`;
    return shell(width, panel.y + panel.h + 46, description, body);
  }

  const panel = { x: 16, y: 116, w: width - 32, h: 220 };
  const legendY = panel.y + panel.h + 34;
  const legend = bands.map((band, i) => {
    const rowY = legendY + i * 28;
    return `<rect x="16" y="${rowY - 11}" width="12" height="12" rx="2" fill="${band.color}"/>
${text(band.name, 38, rowY, 16, { fill: C.ink, weight: 700 })}
${text(`${(band.share * 100).toFixed(band.share < 0.1 ? 1 : 0)}%`, width - 16, rowY, 14, { mono: true, fill: C.muted, anchor: "end" })}`;
  }).join("\n");
  const body = `${header}
<g transform="translate(${panel.x} ${panel.y})"><rect width="${panel.w}" height="${panel.h}" rx="5" fill="${C.night}"/></g>
${prism(bands, { x: 30, y: panel.y + 14, w: panel.w - 28, h: panel.h - 28 }, { labels: false, id: "p" })}
${legend}
${text(caption, 16, legendY + bands.length * 28 + 12, 11, { mono: true, fill: C.muted, spacing: 0.5 })}`;
  return shell(width, legendY + bands.length * 28 + 30, description, body);
}

export async function writePrismAssets(languages, repoCount) {
  const bands = spectrumBands(languages);
  if (!bands.length) return false;
  await Promise.all([false, true].map((mobile) =>
    writeFile(path.join(root, `assets/language-prism${mobile ? "-mobile" : ""}.svg`), render(bands, repoCount, mobile))
  ));
  return true;
}
