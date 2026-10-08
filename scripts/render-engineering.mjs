import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
<style>.sans{font-family:Arial,Helvetica,sans-serif}.mono{font-family:"Liberation Mono",Consolas,monospace}</style>
${rect(0, 0, width, height, C.page, 8)}${body}
</svg>\n`;
}

function heading(number, eyebrow, title, width, mobile, right = "") {
  return `${rule(16, 1, width - 32)}
  ${label(`${number} / ${eyebrow}`, 16, 34, C.orange, mobile ? 13 : 12)}
  ${fit(title, 14, 102, width - 32, mobile ? 42 : 60)}
  ${!mobile && right ? text(right, width - 16, 33, 13, { mono: true, fill: C.muted, anchor: "end" }) : ""}`;
}

function designDiagram(x, y, mobile) {
  const nodeWidth = mobile ? 90 : 150;
  const gap = mobile ? 27 : 36;
  return `<g transform="translate(${x} ${y})">${["BOUNDARIES", "CONTRACTS", "INTERFACES"].map((s, i) => {
    const left = i * (nodeWidth + gap);
    return `${rect(left, 0, nodeWidth, 44, "#d5cebc", 2)}
      ${text(s, left + nodeWidth / 2, 27, mobile ? 9 : 11, { mono: true, fill: C.dark, anchor: "middle", spacing: .5 })}
      ${i < 2 ? `<path d="M${left + nodeWidth + 5} 22h${gap - 10}m-5-4 5 4-5 4" fill="none" stroke="#a84f37" stroke-width="1.5"/>` : ""}`;
  }).join("")}</g>`;
}

function stack(config, mobile) {
  const width = mobile ? 440 : 1200;
  const langY = 141;
  const langHeight = mobile ? 343 : 190;
  let body = heading("01", "THE ENGINEERING DESK", "Tools with a purpose.", width, mobile, "~/stack");
  body += rect(16, langY, width - 32, langHeight);
  body += label("LANGUAGES", 40, langY + 31, C.teal);
  const langs = config.engineering.languages;
  langs.forEach((item, i) => {
    const mobileLast = i === 4;
    const x = mobile ? 40 + (i % 2) * 198 : 40 + i * 229;
    const top = mobile ? langY + 64 + Math.floor(i / 2) * 93 : langY + 65;
    const font = mobile ? 33 : item.name === "TypeScript" ? 36 : 54;
    body += fit(item.name, x, top + 45, mobile ? 172 : 208, mobileLast ? 33 : font);
    body += text(item.focus, x, top + 72, 14, { fill: C.muted });
    if (!mobile && i < langs.length - 1) body += `<path d="M${x + 209} ${langY + 59}v100" stroke="${C.line}"/>`;
  });

  const designY = mobile ? 504 : 351;
  const designW = mobile ? 408 : 600;
  body += rect(16, designY, designW, mobile ? 273 : 296, C.cream);
  body += label("HOW I THINK / SYSTEM DESIGN", 40, designY + 34, "#68665c", mobile ? 11 : 12);
  body += lines(wrap(config.engineering.principle, 17), 38, designY + 100, mobile ? 37 : 49, mobile ? 45 : 55, { fill: C.dark, weight: 700, spacing: -1.7 });
  body += designDiagram(40, designY + (mobile ? 196 : 216), mobile);

  const toolsX = mobile ? 16 : 638;
  const toolsY = mobile ? 797 : 351;
  const toolsW = mobile ? 408 : 546;
  body += rect(toolsX, toolsY, toolsW, 296, "#242220");
  [
    ["BACKEND", config.stack.Backend.filter((s) => s !== "Redis").join(" / ")],
    ["DATA & STATE", ["Redis", "SQLite"].join(" / ")],
    ["INFRASTRUCTURE", config.stack.Infrastructure.join(" / ")]
  ].forEach(([name, value], i) => {
    const y = toolsY + i * 96;
    body += label(name, toolsX + 24, y + 32, C.orange, 11);
    body += fit(value, toolsX + 22, y + 72, toolsW - 48, mobile ? 29 : 37);
    if (i < 2) body += rule(toolsX + 24, y + 93, toolsW - 48, "#3d3833");
  });

  const bottomY = mobile ? 1124 : 690;
  body += label("WORKING TERRITORY", 16, bottomY);
  body += fit(config.stack.Domains.filter((s) => s !== "System design").join(" / "), 14, bottomY + 49, mobile ? 408 : 660, mobile ? 31 : 42);
  const workflowX = mobile ? 16 : 796;
  const workflowY = mobile ? bottomY + 101 : bottomY;
  body += label("DAILY WORKFLOW", workflowX, workflowY, C.teal);
  body += fit(config.stack.Workflow.join(" / "), workflowX - 2, workflowY + 49, mobile ? 408 : 388, mobile ? 31 : 42);
  const height = mobile ? 1336 : 790;
  body += rule(16, height - 29, width - 32);
  return shell(width, height, "Core stack — languages, system design, backend and infrastructure", Object.entries(config.stack).map(([k, v]) => `${k}: ${v.join(", ")}`).join(". "), body);
}

function motif(kind, x, y, width, height) {
  if (kind === "pipeline") {
    // Schematic of the documented discovery → persistence → export pipeline.
    return `<g transform="translate(${x} ${y})">
      ${Array.from({ length: 8 }, (_, i) => `<path d="M0 ${12 + i * 16}Q${width * .25} ${-25 + i * 18} ${width * .52} ${35 + i * 12}T${width} ${12 + i * 16}" fill="none" stroke="#466260" opacity=".55"/>`).join("")}
      <path d="M35 85H${width - 34}" stroke="${C.orange}" stroke-width="2"/>
      ${[35, width / 2, width - 34].map((cx, i) => `<circle cx="${cx}" cy="85" r="${i === 0 ? 8 : 5}" fill="${C.orange}" stroke="#172623" stroke-width="4"/>`).join("")}
      ${text("DISCOVER → STORE → EXPORT", width / 2, height - 9, 10, { mono: true, fill: C.teal, anchor: "middle", spacing: .7 })}
    </g>`;
  }
  return `<g transform="translate(${x} ${y})">
    ${rect(0, 0, width, height, "#11171b")}
    ${label("TCP → HTTP/1.1", 18, 29, C.teal, 11)}
    ${rule(18, 45, width - 36)}
    ${text("GET /health", 18, 75, 17, { mono: true })}
    ${text("200 OK", 18, 111, 28, { mono: true, fill: C.orange, weight: 700 })}
    ${text("ROUTE / STREAM / SHUTDOWN", 18, height - 15, 10, { mono: true, fill: C.muted, spacing: .5 })}
  </g>`;
}

function projectRow(p, index, y, mobile) {
  const width = mobile ? 408 : 1168;
  const tall = index < 2;
  const detailLines = mobile ? p.details.flatMap((s) => wrap(s, 40)) : p.details;
  const motifTop = 111 + detailLines.length * 23 + 12;
  const height = mobile ? (tall ? motifTop + 184 : Math.max(215, motifTop + 35)) : (tall ? 226 : 202);
  const x = 16;
  const fill = index === 0 ? "#172623" : index === 1 ? "#1a222a" : "#181b21";
  let out = rect(x, y, width, height, fill);
  out += label(`${String(index + 1).padStart(2, "0")} / ${p.category}`, x + 24, y + 32, index === 0 ? C.teal : C.orange, mobile ? 9 : 11);
  out += fit(p.name, x + 22, y + (mobile ? 79 : 88), mobile ? 358 : 725, mobile ? 31 : 44);
  out += lines(detailLines, x + 24, y + (mobile ? 111 : 127), mobile ? 16 : 19, mobile ? 23 : 28, { fill: "#b6bfbe" });
  out += text(p.tech.join("  /  "), x + 24, y + height - 21, mobile ? 11 : 12, { mono: true, fill: index === 0 ? C.teal : C.orange });
  if (tall) {
    out += motif(p.motif, mobile ? x + 24 : 866, y + (mobile ? motifTop : 24), mobile ? 360 : 290, mobile ? 139 : 178);
  } else if (!mobile) {
    // Small, code-native symbols keep the lab entries distinct from the main builds.
    if (p.motif === "network") {
      out += `<g transform="translate(946 ${y + 51})"><path d="M0 30h65m0 0 60-30m-60 30 60 30m-60-30v50" fill="none" stroke="#596d75" stroke-width="2"/>${[[0,30],[65,30],[125,0],[125,60],[65,80]].map(([cx,cy]) => `<circle cx="${cx}" cy="${cy}" r="7" fill="${C.panel}" stroke="${C.teal}" stroke-width="2"/>`).join("")}</g>`;
    } else {
      out += `<g transform="translate(942 ${y + 47})">${text("[ ]", 0, 30, 32, { mono: true, fill: C.orange })}${rule(70, 13, 108, "#53616a")}${rule(70, 29, 82, "#53616a")}${text("[✓]", 0, 77, 32, { mono: true, fill: C.teal })}${rule(70, 60, 108, "#53616a")}${rule(70, 76, 60, "#53616a")}</g>`;
    }
  }
  return { body: out, height };
}

function work(config, mobile) {
  const width = mobile ? 440 : 1200;
  let body = heading("02", "SELECTED PUBLIC WORK", "Built, explored, shared.", width, mobile, "~/projects");
  let y = 140;
  config.projects.forEach((p, i) => {
    const row = projectRow(p, i, y, mobile);
    body += row.body;
    y += row.height + 16;
  });
  body += text("Source code & notebooks linked below.", 16, y + 13, mobile ? 13 : 14, { fill: C.muted });
  return shell(width, y + 33, "Selected projects — Lead Hunter, Rust HTTP server, network labs and data science", config.projects.map((p) => `${p.name}: ${p.description}`).join(" "), body);
}

function notes(config, mobile) {
  const width = mobile ? 440 : 1200;
  let body = heading("03", "BEHIND THE WORK", `${config.profile.location.split(",")[0]}. Code. Curiosity.`, width, mobile, "~/about");
  const about = mobile ? config.engineering.aboutMobile : config.engineering.about;
  body += lines(about, 16, 151, mobile ? 20 : 24, 33, { fill: "#bfc5c4" });
  if (!mobile) {
    body += label(config.profile.name.toUpperCase(), 844, 154, C.teal);
    body += text(`@${config.profile.username}`, 842, 197, 31, { weight: 700, spacing: -1 });
    body += text(config.profile.role, 844, 227, 16, { fill: C.muted });
  }
  const focusY = mobile ? 307 : 280;
  body += rule(16, focusY - 23, width - 32);
  config.engineering.focus.forEach((item, i) => {
    const x = mobile ? 16 : 16 + i * 395;
    const y = mobile ? focusY + i * 130 : focusY;
    body += label(item.label, x, y + 12, C.orange);
    body += lines(item.lines, x - 1, y + 53, mobile ? 27 : 28, 35, { weight: 700, spacing: -.5 });
  });
  return shell(width, mobile ? 716 : 402, "About Mohammed Nehad and current focus", `${config.profile.role} in ${config.profile.location}. ${config.profile.statement} ${config.currently.map((r) => `${r.label}: ${r.value}`).join(". ")}`, body);
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
  const renderers = { "engineering-stack": stack, "selected-work": work, "profile-notes": notes, "profile-connect": connect };
  await Promise.all(Object.entries(renderers).flatMap(([name, render]) => [false, true].map((mobile) =>
    writeFile(path.join(root, `assets/${name}${mobile ? "-mobile" : ""}.svg`), render(config, mobile))
  )));
}
