import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lightInk, lightLine, lightModeCss, lightMuted, lightPage } from "./theme.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const C = { page: "#0d1117", ink: "#ede8dd", muted: "#a4a39e", orange: "#ee956e", line: "#30363d", teal: "#9bc7c9", panel: "#171f22", cream: "#e8e2d3", dark: "#282920" };
const xml = (s) => String(s ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

function text(s, x, y, size = 18, { fill = C.ink, mono = false, weight = 400, spacing = 0, anchor = "start" } = {}) {
  return `<text x="${x}" y="${y}" font-size="${size}" class="${mono ? "mono" : "sans"}" fill="${fill}" font-weight="${weight}" letter-spacing="${spacing}" text-anchor="${anchor}">${xml(s)}</text>`;
}
const label = (s, x, y, fill = C.orange, size = 12) => text(s, x, y, size, { mono: true, fill, spacing: 1.5 });
const rule = (x, y, width, color = C.line) => `<path d="M${x} ${y}h${width}" stroke="${color}"/>`;
const rect = (x, y, width, height, fill = C.panel, rx = 4) => `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${rx}" fill="${fill}"/>`;
const lines = (items, x, y, size, gap, options) => items.map((s, i) => text(s, x, y + i * gap, size, options)).join("");

function wrap(value, limit) {
  const result = [];
  for (const word of value.split(/\s+/)) {
    if (!result.length || result.at(-1).length + word.length + 1 > limit) result.push(word);
    else result[result.length - 1] += ` ${word}`;
  }
  return result;
}

function fit(s, x, y, width, size = 40, options = {}) {
  return text(s, x, y, Math.min(size, width / Math.max(1, String(s).length * 0.54)), { weight: 700, spacing: -1, ...options });
}

function shell(width, height, title, description, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc">
<title id="title">${xml(title)}</title><desc id="desc">${xml(description)}</desc>
<style>.sans{font-family:Arial,Helvetica,sans-serif}.mono{font-family:"Liberation Mono",Consolas,monospace}
${lightModeCss({ [C.page]: lightPage, [C.ink]: lightInk, [C.muted]: lightMuted, [C.line]: lightLine, [C.orange]: "#bc4c00", [C.teal]: "#1b7c83" })}</style>
${rect(0, 0, width, height, C.page, 8)}${body}
</svg>\n`;
}

function heading(number, eyebrow, title, width, mobile, right = "") {
  return `${rule(16, 1, width - 32)}
  ${label(`${number} / ${eyebrow}`, 16, 34, C.orange, mobile ? 13 : 12)}
  ${fit(title, 14, 102, width - 32, mobile ? 42 : 60)}
  ${!mobile && right ? text(right, width - 16, 33, 13, { mono: true, fill: C.muted, anchor: "end" }) : ""}`;
}

function itemLines(items, limit) {
  const result = [];
  for (const item of items) {
    if (!result.length || result.at(-1).length + item.length + 3 > limit) result.push(item);
    else result[result.length - 1] += ` · ${item}`;
  }
  return result;
}

function stack(config, mobile) {
  const width = mobile ? 440 : 1200;
  const groups = [
    ["LANGUAGES", config.stack.Languages],
    ["BACKEND", [...config.stack.Backend, "SQLite"]],
    ["INFRASTRUCTURE", [...config.stack.Infrastructure, ...config.stack.Workflow]],
    ["FOCUS", config.stack.Domains]
  ];
  let body = text("Stack", 16, 32, 23, { weight: 600 });
  body += rule(100, 25, width - 116);
  let bottom = 0;
  groups.forEach(([name, items], index) => {
    const x = mobile ? 16 : 16 + (index % 2) * 592;
    const y = mobile ? 71 + index * 77 : 72 + Math.floor(index / 2) * 79;
    const values = itemLines(items, mobile ? 38 : 52);
    body += text(name, x, y, 11, { mono: true, fill: C.muted, spacing: 1 });
    body += lines(values, x, y + 29, mobile ? 18 : 22, 24);
    bottom = Math.max(bottom, y + 29 + (values.length - 1) * 24);
  });
  const extras = config.stack["Data & labs"].filter((item) => item !== "SQLite");
  body += rule(16, bottom + 25, width - 32);
  const extraLines = itemLines(extras, mobile ? 41 : 100);
  body += lines(extraLines, 16, bottom + 51, mobile ? 13 : 15, 21, { fill: C.muted });
  return shell(width, bottom + 67 + (extraLines.length - 1) * 21, "Tech stack", Object.entries(config.stack).map(([name, items]) => `${name}: ${items.join(", ")}`).join(". "), body);
}

function notes(config, mobile) {
  const width = mobile ? 440 : 1200;
  let body = text("About", 16, 32, 23, { weight: 600 });
  body += rule(100, 25, width - 116);
  const introduction = `${config.profile.role} in ${config.profile.location}.`;
  const introLines = wrap(introduction, mobile ? 37 : 100);
  body += lines(introLines, 16, 69, mobile ? 19 : 22, 27);
  const descriptionY = 69 + introLines.length * 27 + 3;
  const description = mobile ? ["Backends, interfaces,", "and geospatial systems."] : ["Backends, interfaces, and geospatial systems."];
  body += lines(description, 16, descriptionY, mobile ? 18 : 20, 26, { fill: C.muted });
  return shell(width, descriptionY + (description.length - 1) * 26 + 25, "About " + config.profile.name, `${introduction} ${config.profile.statement}`, body);
}

function connect(config, mobile) {
  const width = mobile ? 440 : 1200;
  const height = mobile ? 215 : 180;
  let body = rule(16, 1, width - 32);
  body += label("04 / KEEP IN TOUCH", 16, 37);
  body += fit("Let's build something thoughtful.", 14, 99, width - 32, mobile ? 28 : 46);
  body += text(`github.com/${config.profile.username} ↗`, 16, 147, mobile ? 17 : 20, { mono: true, fill: C.teal });
  if (!mobile) body += text(config.profile.location, width - 16, 147, 17, { fill: C.muted, anchor: "end" });
  return shell(width, height, "Connect with Mohammed Nehad on GitHub", `GitHub: ${config.profile.username}. ${config.profile.location}.`, body);
}

export function engineeringPicture(name, alt) {
  return `<picture>\n  <source media="(max-width: 640px)" srcset="./assets/${name}-mobile.svg">\n  <img src="./assets/${name}.svg" width="100%" alt="${xml(alt)}">\n</picture>`;
}

export async function writeEngineeringAssets(config) {
  const renderers = { "engineering-stack": stack, "profile-notes": notes, "profile-connect": connect };
  await Promise.all(Object.entries(renderers).flatMap(([name, render]) => [false, true].map((mobile) =>
    writeFile(path.join(root, `assets/${name}${mobile ? "-mobile" : ""}.svg`), render(config, mobile))
  )));
}
