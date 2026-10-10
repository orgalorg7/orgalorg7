import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lightInk, lightLine, lightModeCss, lightMuted, lightPage } from "./theme.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ink = "#ede8dd";
const muted = "#a4a39e";
const accent = "#ee956e";

function xml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function text(value, x, y, size, options = {}) {
  const { fill = ink, family = "sans", weight = 400, spacing = 0, anchor = "start" } = options;
  return `<text x="${x}" y="${y}" font-size="${size}" class="${family}" fill="${fill}" font-weight="${weight}" letter-spacing="${spacing}" text-anchor="${anchor}">${xml(value)}</text>`;
}

function title(value, x, y, maxWidth, size, fill = ink) {
  // Scale unusually long configured titles to keep them inside their panel.
  return text(value, x, y, Math.min(size, maxWidth / Math.max(1, value.length * 0.58)), {
    fill, weight: 700, spacing: -1.5
  });
}

function cover(data, x, y, width, height = width) {
  return data ? `<image href="${data}" x="${x}" y="${y}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid meet"/>` : "";
}

function vinyl(cx, cy, radius) {
  const grooves = Array.from({ length: 24 }, (_, i) =>
    `<circle cx="${cx}" cy="${cy}" r="${(radius * (0.4 + i * 0.024)).toFixed(2)}" fill="none" stroke="${i % 3 ? "#30302d" : "#45433d"}" stroke-width=".65"/>`
  ).join("");
  // The label and its off-centre marks spin with the record; the glare stays put like a real reflection.
  return `<g class="spin">
    <circle cx="${cx}" cy="${cy}" r="${radius}" fill="url(#vinyl)" stroke="#34342e"/>
    ${grooves}
    <circle cx="${cx}" cy="${cy}" r="${radius * 0.29}" fill="#b94d37"/>
    <circle cx="${cx}" cy="${cy}" r="${radius * 0.22}" fill="none" stroke="#e48a64" stroke-width=".7"/>
    ${text("SIDE A", cx, cy - 9, 9, { fill: "#f5ddbd", family: "mono", anchor: "middle", spacing: 2 })}
    ${text("33⅓ RPM", cx, cy + 17, 7, { fill: "#f5ddbd", family: "mono", anchor: "middle", spacing: 1.5 })}
    <path d="M${cx - radius * 0.62} ${cy + radius * 0.5}A${radius * 0.8} ${radius * 0.8} 0 0 1 ${cx - radius * 0.79} ${cy + radius * 0.12}" fill="none" stroke="#ffffff" opacity=".12" stroke-width="3" stroke-linecap="round"/>
    <circle cx="${cx}" cy="${cy}" r="4" fill="#e8e0d0"/>
  </g>
    <path d="M${cx - radius * 0.8} ${cy - radius * 0.45}L${cx - radius * 0.32} ${cy - radius * 0.12}M${cx + radius * 0.32} ${cy + radius * 0.12}L${cx + radius * 0.8} ${cy + radius * 0.45}" stroke="#ffffff" opacity=".07" stroke-width="18"/>
    ${tonearm(cx, cy, radius)}
  `;
}

function tonearm(cx, cy, radius) {
  const pivotX = cx + radius * 0.98;
  const pivotY = cy - radius * 0.95;
  const headX = cx + radius * 0.42;
  const headY = cy + radius * 0.38;
  const angle = Math.atan2(headY - pivotY, headX - pivotX) * 180 / Math.PI;
  return `<g aria-hidden="true">
    <circle cx="${pivotX}" cy="${pivotY}" r="${radius * 0.11}" fill="#c9c2b1" stroke="#8d8676"/>
    <circle cx="${pivotX}" cy="${pivotY}" r="${radius * 0.045}" fill="#5b574d"/>
    <path d="M${pivotX} ${pivotY}L${headX} ${headY}" stroke="#d8d1bf" stroke-width="${(radius * 0.03).toFixed(2)}" stroke-linecap="round"/>
    <rect x="${headX - radius * 0.05}" y="${headY - radius * 0.035}" width="${radius * 0.13}" height="${radius * 0.07}" rx="2" fill="#3a3832" transform="rotate(${angle.toFixed(1)} ${headX} ${headY})"/>
  </g>`;
}

function albumPanel(item, image, x, y, width, mobile) {
  const height = mobile ? 452 : 514;
  const dark = "#282920";
  const recordX = mobile ? 273 : 395;
  const recordY = mobile ? 301 : 336;
  const radius = mobile ? 106 : 143;
  const artSize = mobile ? 214 : 286;
  const artY = (mobile ? 190 : 186) + artSize * 0.05;
  const artHeight = artSize * 0.9;
  return `<g transform="translate(${x} ${y})">
    <rect width="${width}" height="${height}" rx="5" fill="#e8e2d3"/>
    ${text("01 / FAVORITE ALBUM", 28, 36, mobile ? 14 : 13, { family: "mono", fill: "#68665c", spacing: 1 })}
    ${text(item.year || "", width - 28, 36, 14, { family: "mono", fill: "#68665c", anchor: "end" })}
    ${title(item.title, 26, 108, width - 56, mobile ? 55 : 68, dark)}
    ${text(item.artist, 28, 144, 22, { fill: "#615f55" })}
    ${vinyl(recordX, recordY, radius)}
    <rect x="32" y="${artY + 5}" width="${artSize}" height="${artHeight}" fill="#82785e" opacity=".18"/>
    ${cover(image, 28, artY, artSize, artHeight)}
    <path d="M28 ${height - 28}h30" stroke="#a84f37" stroke-width="2"/>
    ${text("THE RECORD SHELF", 70, height - 23, 11, { family: "mono", fill: "#6b685d", spacing: 2 })}
  </g>`;
}

function songPanel(item, image, x, y, width, mobile) {
  const left = mobile ? 166 : 210;
  const art = mobile ? 114 : 158;
  const titleSize = mobile ? 38 : 45;
  const bars = Array.from({ length: mobile ? 25 : 35 }, (_, i) => {
    const h = 8 + Math.round(27 * Math.abs(Math.sin(i * 1.77) * Math.cos(i * 0.39)));
    // Uneven durations and negative delays keep the bars from pulsing in lockstep.
    const motion = `animation-duration:${(0.45 + ((i * 37) % 9) / 12).toFixed(2)}s;animation-delay:-${((i * 0.29) % 1.3).toFixed(2)}s`;
    return `<rect x="${left + i * 7}" y="${205 - h}" width="3" height="${h}" rx="1.5" fill="${i % 5 === 0 ? "#eac4ab" : accent}" opacity="${i % 3 === 0 ? ".6" : "1"}" class="eq" style="${motion}"/>`;
  }).join("");
  return `<g transform="translate(${x} ${y})">
    <rect width="${width}" height="249" rx="5" fill="#292322"/>
    ${text("02 / FAVORITE SONG", 26, 35, 13, { family: "mono", fill: accent, spacing: 1 })}
    ${cover(image, 26, 62, art)}
    ${title(item.title, left, 103, width - left - 20, titleSize)}
    ${text(item.artist, left, 133, mobile ? 17 : 20, { fill: "#c3b0a9" })}
    <g aria-hidden="true">${bars}</g>
    ${text(item.year || "", 26, 236, 11, { family: "mono", fill: "#c3b0a9", spacing: 1.5 })}
  </g>`;
}

function moviePanel(item, image, x, y, width, mobile) {
  const left = mobile ? 166 : 210;
  const artWidth = mobile ? 114 : 158;
  return `<g transform="translate(${x} ${y})">
    <rect width="${width}" height="249" rx="5" fill="#171f22"/>
    ${cover(image, 26, 17, artWidth, 216)}
    ${text("03 / FAVORITE FILM", left, 42, mobile ? 12 : 13, { family: "mono", fill: "#a2b6b9", spacing: 1 })}
    ${title(item.title, left, 112, width - left - 22, mobile ? 37 : 46)}
    ${text(item.year || "", left, 143, 16, { family: "mono", fill: muted })}
    <path d="M${left} 170h${width - left - 28}" stroke="#374348"/>
    ${item.director ? text("DIRECTED BY", left, 196, 10, { family: "mono", fill: "#8a9d9f", spacing: 1.4 }) : ""}
    ${text(item.director, left, 221, mobile ? 16 : 18, { fill: "#c7cecc" })}
    <clipPath id="film-edge"><rect width="${width}" height="249" rx="5"/></clipPath>
    <g clip-path="url(#film-edge)"><g class="reel">
      ${Array.from({ length: 16 }, (_, i) => `<rect x="${width - 9}" y="${11 + (i - 1) * 17}" width="4" height="8" rx="1" fill="#364044"/>`).join("")}
    </g></g>
  </g>`;
}

// The Wall's crossed hammers, one pair per public repository, marching through the footer.
function hammer(angle, fill) {
  return `<g transform="rotate(${angle})"><rect x="-1.1" y="-5" width="2.2" height="14" rx="1" fill="${fill}"/><rect x="-5.5" y="-8.5" width="11" height="4.2" rx=".6" fill="${fill}"/></g>`;
}

function hammers(count, x0, x1, y, mobile) {
  if (!count) return "";
  const spacing = mobile ? 24 : 40;
  const scale = mobile ? 0.9 : 1.25;
  const row = count * spacing;
  const travel = x1 - x0 + row;
  const marchers = Array.from({ length: count }, (_, i) =>
    `<g transform="translate(${(x0 - row + i * spacing + spacing / 2).toFixed(1)} ${y}) scale(${scale})"><g class="stomp" style="animation-delay:${i % 2 ? "-.28" : "0"}s">${hammer(-38, "#c3352b")}${hammer(38, "#e2483a")}</g></g>`
  ).join("");
  return `<defs>
    <linearGradient id="march-fade" x1="0" x2="1"><stop offset="0" stop-color="#000"/><stop offset=".14" stop-color="#fff"/><stop offset=".86" stop-color="#fff"/><stop offset="1" stop-color="#000"/></linearGradient>
    <mask id="march-mask" maskUnits="userSpaceOnUse" x="${x0}" y="${y - 16}" width="${x1 - x0}" height="32"><rect x="${x0}" y="${y - 16}" width="${x1 - x0}" height="32" fill="url(#march-fade)"/></mask>
  </defs>
  <g mask="url(#march-mask)" aria-hidden="true"><g class="march" style="--travel:${travel.toFixed(0)}px;animation-duration:${(travel / 42).toFixed(1)}s">${marchers}</g></g>`;
}

function render(favorites, images, mobile, repoCount) {
  const width = mobile ? 440 : 1200;
  const height = mobile ? 1185 : 714;
  const { album, song, movie } = favorites;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="favorites-title favorites-desc">
  <title id="favorites-title">Off the clock — favorite album, song and film</title>
  <desc id="favorites-desc">${xml(`${album.title} by ${album.artist}; ${song.title} by ${song.artist}; ${movie.title}${movie.director ? `, directed by ${movie.director}` : ""}.`)}</desc>
  <defs>
    <radialGradient id="vinyl"><stop stop-color="#232321"/><stop offset=".65" stop-color="#101211"/><stop offset="1" stop-color="#232522"/></radialGradient>
  </defs>
  <style>
    .sans { font-family: Arial, Helvetica, sans-serif; }
    .mono { font-family: "Liberation Mono", Consolas, monospace; }
    .spin { transform-box: fill-box; transform-origin: center; animation: spin 1.8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .eq { transform-box: fill-box; transform-origin: 50% 100%; animation: eq .9s ease-in-out infinite alternate; }
    @keyframes eq { from { transform: scaleY(.2); } to { transform: scaleY(1); } }
    .reel { animation: reel .7s linear infinite; }
    @keyframes reel { from { transform: translateY(-17px); } to { transform: translateY(0); } }
    .march { animation: march linear infinite; }
    @keyframes march { to { transform: translateX(var(--travel)); } }
    .stomp { transform-box: fill-box; transform-origin: 50% 100%; animation: stomp .56s steps(1, end) infinite; }
    @keyframes stomp { 50% { transform: translateY(-2.5px) rotate(-4deg); } }
    @media (prefers-reduced-motion: reduce) { .spin, .eq, .reel, .stomp { animation: none; } .march { animation: none; transform: translateX(calc(var(--travel) * .6)); } }
    ${lightModeCss({ "#0d1117": lightPage, [ink]: lightInk, [muted]: lightMuted, "#30363d": lightLine, [accent]: "#bc4c00" }, { scope: "svg > " })}
  </style>
  <rect width="${width}" height="${height}" rx="8" fill="#0d1117"/>
  <path d="M16 1h${width - 32}" stroke="#30363d"/>
  ${text("THE PERSONAL COLLECTION", 16, 34, mobile ? 13 : 12, { family: "mono", fill: accent, spacing: 2 })}
  ${mobile ? "" : text("~/off-duty", width - 16, 34, 13, { family: "mono", fill: muted, anchor: "end" })}
  ${text("Off the clock.", 14, 100, mobile ? 47 : 60, { weight: 700, spacing: -2.5 })}
  ${mobile ? "" : text("A record. A song. A film.", width - 16, 96, 18, { fill: muted, anchor: "end" })}
  ${albumPanel(album, images.album, 16, 135, mobile ? 408 : 642, mobile)}
  ${songPanel(song, images.song, mobile ? 16 : 678, mobile ? 603 : 135, mobile ? 408 : 506, mobile)}
  ${moviePanel(movie, images.movie, mobile ? 16 : 678, mobile ? 868 : 400, mobile ? 408 : 506, mobile)}
  <path d="M16 ${height - 42}h${width - 32}" stroke="#30363d"/>
  ${hammers(repoCount, mobile ? 148 : 200, mobile ? 286 : 960, height - 19, mobile)}
  ${text("END OF SIDE A", 16, height - 15, 11, { family: "mono", fill: muted, spacing: 2 })}
  ${text("PERSONAL ARCHIVE / 003", width - 16, height - 15, mobile ? 10 : 12, { family: "mono", fill: muted, anchor: "end" })}
</svg>\n`;
}

export function hasFavorites(config) {
  return ["album", "song", "movie"].every((key) => config.favorites?.[key]?.title?.trim());
}

export function favoritesMarkdown(config) {
  if (!hasFavorites(config)) {
    const entries = [
      ["Album", config.favorites?.album],
      ["Song", config.favorites?.song],
      ["Film", config.favorites?.movie]
    ].filter(([, item]) => item?.title?.trim());
    if (!entries.length) return "";
    return `\n## Off the clock\n\n${entries.map(([label, item]) => {
      const credit = item.artist || item.director;
      return `<p><strong>${label}</strong> · ${xml(item.title)}${credit ? ` — ${xml(credit)}` : ""}</p>`;
    }).join("\n")}\n`;
  }
  const { album, song, movie } = config.favorites;
  const alt = xml(`Favorites: ${album.title} — ${album.artist}; ${song.title} — ${song.artist}; ${movie.title}.`);
  // Links sit outside the SVG because SVGs embedded as images cannot be clicked.
  const links = [[album, "Album"], [song, "Song"], [movie, "Film"]]
    .filter(([item]) => /^https:\/\//.test(item.url || ""))
    .map(([item, label]) => `<a href="${xml(item.url)}">${label} ↗</a>`).join(" &nbsp; · &nbsp; ");
  return `\n<picture>\n  <source media="(max-width: 640px)" srcset="./assets/favorites-mobile.svg">\n  <img src="./assets/favorites.svg" width="100%" alt="${alt}">\n</picture>\n\n<sub>${links}</sub>\n`;
}

export async function writeFavoritesAssets(config, repoCount = config.statsFallback?.repositories) {
  if (!hasFavorites(config)) return;
  const images = Object.fromEntries(await Promise.all(["album", "song", "movie"].map(async (key) => {
    const filename = config.favorites[key].artwork;
    if (!filename) return [key, ""];
    const bytes = await readFile(path.join(rootDir, filename));
    return [key, `data:image/jpeg;base64,${bytes.toString("base64")}`];
  })));
  await Promise.all([
    writeFile(path.join(rootDir, "assets/favorites.svg"), render(config.favorites, images, false, repoCount)),
    writeFile(path.join(rootDir, "assets/favorites-mobile.svg"), render(config.favorites, images, true, repoCount))
  ]);
}
