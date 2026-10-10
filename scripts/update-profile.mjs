#!/usr/bin/env node

import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { favoritesMarkdown, writeFavoritesAssets } from "./render-favorites.mjs";
import { engineeringPicture, writeEngineeringAssets } from "./render-engineering.mjs";
import { lightInk, lightLine, lightModeCss, lightMuted, lightPage } from "./theme.mjs";
import { writePrismAssets } from "./render-prism.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");
const configPath = path.join(rootDir, "profile.config.json");
const assetsDir = path.join(rootDir, "assets");
const portraitPath = path.join(assetsDir, "ascii-portrait.json");
const desktopSvgPath = path.join(assetsDir, "profile-terminal.svg");
const mobileSvgPath = path.join(assetsDir, "profile-terminal-mobile.svg");
const readmePath = path.join(rootDir, "README.md");

const offline = process.argv.includes("--offline");
const readmeOnly = process.argv.includes("--readme-only");
const token = process.env.GITHUB_TOKEN?.trim();

const palette = {
  page: "#0d1117",
  card: "#10151d",
  chrome: "#161d27",
  border: "#30363d",
  primary: "#c9d1d9",
  secondary: "#8b949e",
  faint: "#484f58",
  orange: "#f0883e",
  blue: "#58a6ff",
  cyan: "#76e3ea",
  green: "#3fb950",
  red: "#f85149"
};

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function assertConfig(config) {
  const required = [
    ["profile.username", config.profile?.username],
    ["profile.name", config.profile?.name],
    ["profile.role", config.profile?.role],
    ["profile.statement", config.profile?.statement],
    ["terminal.title", config.terminal?.title],
    ["terminal.command", config.terminal?.command]
  ];

  const missing = required.filter(([, value]) => !value).map(([key]) => key);
  if (missing.length) {
    throw new Error(`Missing required config values: ${missing.join(", ")}`);
  }

  if (!Array.isArray(config.terminal.ascii) || config.terminal.ascii.length < 6) {
    throw new Error("terminal.ascii must contain at least six rows");
  }

  for (const section of [config.system, config.currently]) {
    if (!Array.isArray(section) || section.some((row) => !row.label || !row.value)) {
      throw new Error("system and currently must contain { label, value } rows");
    }
  }
}

function truncate(value, maxLength) {
  const text = String(value);
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}…`;
}

function assertPortrait(portrait) {
  if (!portrait || !Array.isArray(portrait.palette) || !Array.isArray(portrait.lines)) {
    throw new Error("ASCII portrait data is malformed");
  }
  if (portrait.lines.length !== portrait.rows) {
    throw new Error("ASCII portrait row count does not match its metadata");
  }
  for (const line of portrait.lines) {
    if (line.chars.length !== portrait.columns || line.colors.length !== portrait.columns) {
      throw new Error("ASCII portrait line width does not match its metadata");
    }
    if (!Array.isArray(line.colors) || line.colors.some((index) =>
      !Number.isInteger(index) || index < 0 || index >= portrait.palette.length
    )) {
      throw new Error("ASCII portrait contains an invalid palette index");
    }
  }
}

function formatNumber(value) {
  return Number.isFinite(value) ? new Intl.NumberFormat("en-US").format(value) : "—";
}

async function fileExists(filePath) {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function githubRequest(url, options = {}) {
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "orgalorg7-profile-updater",
    ...options.headers
  };

  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(url, {
    ...options,
    headers,
    signal: AbortSignal.timeout(15_000)
  });

  if (!response.ok) {
    const remaining = response.headers.get("x-ratelimit-remaining");
    const reset = response.headers.get("x-ratelimit-reset");
    const context = remaining === "0" && reset
      ? `; rate limit resets at ${new Date(Number(reset) * 1000).toISOString()}`
      : "";
    throw new Error(`GitHub API ${response.status} for ${url}${context}`);
  }

  return response.json();
}

async function fetchAllRepositories(username, expectedCount) {
  const repositories = [];
  const maxPages = Math.max(1, Math.min(20, Math.ceil(expectedCount / 100) + 1));

  for (let page = 1; page <= maxPages; page += 1) {
    const batch = await githubRequest(
      `https://api.github.com/users/${encodeURIComponent(username)}/repos?type=owner&per_page=100&page=${page}`
    );
    repositories.push(...batch);
    if (batch.length < 100) break;
  }

  return repositories;
}

async function fetchContributions(username) {
  if (!token) return null;

  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  const query = `
    query ProfileContributions($login: String!, $from: DateTime!, $to: DateTime!) {
      user(login: $login) {
        contributionsCollection(from: $from, to: $to) {
          contributionCalendar { totalContributions }
        }
      }
    }
  `;

  try {
    const data = await githubRequest("https://api.github.com/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        variables: { login: username, from: from.toISOString(), to: now.toISOString() }
      })
    });

    return data.data?.user?.contributionsCollection?.contributionCalendar?.totalContributions ?? null;
  } catch (error) {
    console.warn(`Contribution lookup skipped: ${error.message}`);
    return null;
  }
}

// Bytes per language across original public repos (forks and this profile repo excluded).
// Any failed lookup discards the set, since partial data would skew the spectrum.
async function fetchLanguages(username, repositories) {
  const own = repositories
    .filter((repository) => !repository.fork && repository.name.toLowerCase() !== username.toLowerCase())
    .slice(0, 30);
  try {
    const results = await Promise.all(own.map((repository) => githubRequest(repository.languages_url)));
    const languages = {};
    for (const result of results) {
      for (const [name, bytes] of Object.entries(result)) languages[name] = (languages[name] ?? 0) + bytes;
    }
    return { languages, languageRepos: results.filter((result) => Object.keys(result).length).length };
  } catch (error) {
    console.warn(`Language lookup skipped: ${error.message}`);
    return { languages: null, languageRepos: null };
  }
}

async function fetchPublicStats(username) {
  const profile = await githubRequest(`https://api.github.com/users/${encodeURIComponent(username)}`);
  const [repositories, commitSearch, contributions] = await Promise.all([
    fetchAllRepositories(username, profile.public_repos),
    githubRequest(`https://api.github.com/search/commits?q=author%3A${encodeURIComponent(username)}&per_page=1`)
      .catch((error) => {
        console.warn(`Commit lookup skipped: ${error.message}`);
        return null;
      }),
    fetchContributions(username)
  ]);

  return {
    repositories: profile.public_repos,
    followers: profile.followers,
    stars: repositories.reduce((total, repository) => total + repository.stargazers_count, 0),
    commits: commitSearch?.total_count ?? null,
    contributions,
    createdAt: profile.created_at,
    ...await fetchLanguages(username, repositories)
  };
}

function svgShell({ width, height, title, chromeTitle, description, content }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="svg-title svg-desc">
  <title id="svg-title">${escapeXml(title)}</title>
  <desc id="svg-desc">${escapeXml(description)}</desc>
  <style>
    text { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; }
    .primary { fill: ${palette.primary}; }
    .secondary { fill: ${palette.secondary}; }
    .label { fill: ${palette.orange}; font-weight: 600; }
    .value { fill: ${palette.blue}; }
    .accent { fill: ${palette.cyan}; }
    .section { fill: ${palette.primary}; font-weight: 700; letter-spacing: .7px; }
    .leader { stroke: ${palette.faint}; stroke-width: 2; stroke-linecap: round; stroke-dasharray: 1 7; }
    .rule { stroke: ${palette.border}; stroke-width: 1; }
    .boot { animation: boot .55s ease-out both; }
    .blink { animation: blink 1.1s steps(1) infinite; }
    .beam { animation: beam 6.5s linear infinite; }
    @keyframes boot { 0% { opacity: 0; } 55% { opacity: 1; } 70% { opacity: .3; } 100% { opacity: 1; } }
    @keyframes blink { 50% { opacity: 0; } }
    @keyframes beam { from { transform: translateY(0); } 40%, to { transform: translateY(var(--beam-travel)); } }
    .eq { transform-box: fill-box; transform-origin: 50% 100%; animation: eq .8s ease-in-out infinite alternate; }
    @keyframes eq { from { transform: scaleY(.25); } to { transform: scaleY(1); } }
    .steam { animation: steam 1.6s ease-out infinite; opacity: 0; }
    @keyframes steam { 0% { opacity: 0; transform: translateY(3px); } 40% { opacity: .8; } 100% { opacity: 0; transform: translateY(-5px); } }
    .sun { transform-box: fill-box; transform-origin: center; animation: sun 12s linear infinite; }
    @keyframes sun { to { transform: rotate(360deg); } }
    .bios { transform-box: fill-box; transform-origin: center; animation: bios-out .6s ease-in ${biosDuration - 0.6}s forwards; }
    @keyframes bios-out {
      0% { transform: none; opacity: 1; }
      15% { transform: translateX(-16px) skewX(-8deg); }
      30% { transform: translateX(12px); opacity: .7; }
      45% { transform: translateX(-5px); opacity: 1; }
      75% { transform: scaleY(.012); opacity: .95; }
      100% { transform: scaleX(0) scaleY(.012); opacity: 0; visibility: hidden; }
    }
    .bios-bar { transform-box: fill-box; transform-origin: left; animation: bios-bar 2.1s cubic-bezier(.3,.1,.4,1) .3s both; }
    @keyframes bios-bar { from { transform: scaleX(0); } to { transform: scaleX(1); } }
    .glitch { animation: glitch 7s steps(1, end) infinite; }
    @keyframes glitch { 0%, 90%, 92.5%, 95.5%, 100% { transform: none; } 90.8% { transform: translateX(var(--gx)); } 94% { transform: translateX(calc(var(--gx) * -.6)); } }
    .rgb { animation: rgb 7s steps(1, end) infinite; }
    @keyframes rgb { 0%, 90%, 95.5%, 100% { filter: url(#crt-glow); } 90.5%, 94% { filter: url(#crt-glow) drop-shadow(-3px 0 rgba(255, 40, 90, .85)) drop-shadow(3px 0 rgba(40, 220, 255, .85)); } }
    .tear { opacity: 0; animation: tear 7s steps(1, end) infinite; }
    @keyframes tear { 0%, 91.6%, 93.6%, 95%, 100% { opacity: 0; } 90.4% { opacity: .75; } 94% { opacity: .5; } }
    @media (prefers-reduced-motion: reduce) { .boot, .blink, .eq, .sun, .glitch, .rgb, .tear { animation: none; } .steam { animation: none; opacity: .6; } .beam, .bios, .tear { display: none; } }
    ${lightModeCss({
      [palette.page]: lightPage,
      [palette.card]: "#f6f8fa",
      [palette.chrome]: "#eaeef2",
      [palette.border]: lightLine,
      [palette.secondary]: lightMuted,
      [palette.blue]: "#0969da"
    }, {
      // Portrait glyphs (tspans) share some of these colors, so they are left alone on their dark CRT screen.
      scope: ":not(tspan)",
      extra: `.primary,.section{fill:${lightInk}}.secondary{fill:${lightMuted}}.label{fill:#bc4c00}.value{fill:#0969da}.accent{fill:#1b7c83}.leader{stroke:#afb8c1}.rule{stroke:${lightLine}}rect.screen{fill:${palette.page}}`
    })}
  </style>
  <rect width="${width}" height="${height}" rx="18" fill="${palette.page}"/>
  <rect x="16" y="16" width="${width - 32}" height="${height - 32}" rx="16" fill="${palette.card}" stroke="${palette.border}"/>
  <path d="M32 16h${width - 64}a16 16 0 0 1 16 16v34H16V32a16 16 0 0 1 16-16Z" fill="${palette.chrome}"/>
  <line x1="16" y1="66" x2="${width - 16}" y2="66" class="rule"/>
  <circle cx="42" cy="41" r="6" fill="${palette.red}" opacity=".85"/>
  <circle cx="64" cy="41" r="6" fill="${palette.orange}" opacity=".85"/>
  <circle cx="86" cy="41" r="6" fill="${palette.green}" opacity=".85"/>
  <text x="112" y="47" class="primary" font-size="17" font-weight="600">${escapeXml(chromeTitle)}</text>
  ${content}
</svg>
`;
}

function desktopRow({ label, value, y, labelX = 488, leaderX = 640, valueX = 1144, max = 47 }) {
  const safeValue = truncate(value, max);
  const estimatedWidth = safeValue.length * 9.1;
  const leaderEnd = Math.max(leaderX + 18, valueX - estimatedWidth - 18);
  return `<text x="${labelX}" y="${y}" class="label" font-size="16">${escapeXml(label)}</text>
    <line x1="${leaderX}" y1="${y - 5}" x2="${leaderEnd.toFixed(1)}" y2="${y - 5}" class="leader"/>
    <text x="${valueX}" y="${y}" text-anchor="end" class="value" font-size="16">${escapeXml(safeValue)}</text>`;
}

function sectionHeading(title, y, x1 = 472, x2 = 1144) {
  return `<text x="${x1}" y="${y}" class="section" font-size="15">${escapeXml(title)}</text>
    <line x1="${x1 + 96}" y1="${y - 5}" x2="${x2}" y2="${y - 5}" class="rule"/>`;
}

function uptime(createdAt, now = new Date()) {
  const start = new Date(createdAt);
  if (Number.isNaN(start.getTime())) return null;
  const months = (now.getUTCFullYear() - start.getUTCFullYear()) * 12
    + now.getUTCMonth() - start.getUTCMonth()
    - (now.getUTCDate() < start.getUTCDate() ? 1 : 0);
  const since = start.toLocaleString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
  return `${Math.floor(months / 12)}y ${months % 12}m · since ${since}`;
}

function systemRows(config, stats) {
  const up = uptime(stats.createdAt);
  return [
    { label: "Role", value: config.profile.role },
    ...(config.profile.location ? [{ label: "Base", value: config.profile.location }] : []),
    ...(up ? [{ label: "Uptime", value: up }] : []),
    ...config.system
  ];
}

// One track per UTC day, so the nightly refresh rotates through the list.
function nowPlaying(config, now = new Date()) {
  const tracks = config.nowPlaying?.filter((track) => track.title && track.artist) ?? [];
  if (!tracks.length) return null;
  return tracks[Math.floor(now.getTime() / 86_400_000) % tracks.length];
}

function equalizer(x, baseline, count = 4) {
  return Array.from({ length: count }, (_, i) =>
    `<rect x="${x + i * 5}" y="${baseline - 12}" width="3" height="12" rx="1" fill="${palette.orange}" class="eq" style="animation-delay:-${(i * 0.37).toFixed(2)}s;animation-duration:${(0.55 + i * 0.13).toFixed(2)}s"/>`
  ).join("");
}

function nowPlayingBlock(track, { x, y, width, mobile }) {
  if (!track) return "";
  const header = `${equalizer(x, y)}
  <text x="${x + 26}" y="${y}" class="secondary" font-size="12" letter-spacing="1.5">NOW PLAYING</text>`;
  if (mobile) {
    return `${header}
  <text x="${x}" y="${y + 26}" class="primary" font-size="16" font-weight="700">${escapeXml(truncate(`${track.title} — ${track.artist}`, Math.floor(width / 9.6)))}</text>`;
  }
  return `${header}
  <text x="${x}" y="${y + 26}" class="primary" font-size="17" font-weight="700">${escapeXml(truncate(track.title, Math.floor(width / 10.2)))}</text>
  <text x="${x}" y="${y + 48}" class="secondary" font-size="14">${escapeXml(track.artist)}</text>`;
}

function contactRows(config) {
  const rows = [];
  if (config.contact.github) {
    rows.push({ label: "GitHub", value: `github.com/${config.profile.username}` });
  }
  if (config.contact.email) rows.push({ label: "Email", value: config.contact.email });
  if (config.contact.linkedin) {
    rows.push({ label: "LinkedIn", value: config.contact.linkedin.replace(/^https?:\/\//, "") });
  }
  if (config.contact.website) {
    rows.push({ label: "Website", value: config.contact.website.replace(/^https?:\/\//, "") });
  }
  return rows;
}

function statRows(stats) {
  const rows = [
    { label: "Repositories", value: formatNumber(stats.repositories) },
    { label: "Followers", value: formatNumber(stats.followers) },
    { label: "Stars", value: formatNumber(stats.stars) }
  ];

  if (Number.isFinite(stats.contributions)) {
    rows.push({ label: "Contrib. YTD", value: formatNumber(stats.contributions) });
  } else if (Number.isFinite(stats.commits)) {
    rows.push({ label: "Public commits", value: formatNumber(stats.commits) });
  }

  return rows;
}

// Timeline (seconds): a BIOS screen plays, the command types itself, then the output "boots" in.
const biosDuration = 3.2;
const typeStart = 0.4;
const typeCharDuration = 0.065;
const glitchAfterPortrait = 2.5;

// A fake POST/kernel log covers the card, then glitches and collapses like a CRT switching over.
function biosScreen(config, { width, height }) {
  const year = new Date().getUTCFullYear();
  const city = (config.profile.location?.split(",")[0] || "local").toLowerCase();
  const modules = config.stack.Languages.map((language) => language.toLowerCase()).join(" ");
  const log = [
    [`ORGALORG BIOS v7.0  (C) ${year} ${config.profile.name.toUpperCase()}`, null],
    ["CPU: caffeine-cooled core @ 4.20GHz", "OK"],
    ["Memory test: 32768K", "OK"],
    ["", null],
    [`[ 0.000] booting kernel profile-7.0-${city}`, null],
    [`[ 0.112] mounting /dev/${config.profile.username}`, "OK"],
    [`[ 0.204] loading modules: ${modules}`, "OK"],
    ["[ 0.318] starting geospatial-daemon", "OK"],
    ["[ 0.405] handshake github.com:443", "OK"],
    ["[ 0.511] decrypting portrait.ascii", "OK"],
    [`[ 0.620] reached target: ${config.terminal.title}`, null]
  ];
  // Literal colors (not palette entries) keep the BIOS screen dark in light mode too.
  const lines = log.map(([line, status], i) => line ? delayed(0.08 + i * 0.17, `<text x="38" y="${100 + i * 22}" font-size="14" fill="${i === 0 ? "#e6edf3" : "#9da7b3"}"${i === 0 ? ' font-weight="700"' : ""}>${escapeXml(line)}</text>${status ? `
    <text x="${width - 40}" y="${100 + i * 22}" text-anchor="end" font-size="14" fill="${palette.green}">[ ${status} ]</text>` : ""}`) : "").join("\n    ");
  const barY = 100 + log.length * 22 + 26;
  const barWidth = Math.min(420, width - 76);
  return `<g class="bios" aria-hidden="true">
    <path d="M17 67H${width - 17}V${height - 32}a15 15 0 0 1 -15 15H32a15 15 0 0 1 -15 -15Z" fill="#05070a"/>
    ${lines}
    ${delayed(0.3, `<text x="38" y="${barY}" font-size="13" fill="#9da7b3" letter-spacing="1">LOADING PROFILE</text>
    <rect x="38" y="${barY + 12}" width="${barWidth}" height="10" rx="2" fill="none" stroke="#3d444d"/>
    <rect x="40" y="${barY + 14}" width="${barWidth - 4}" height="6" rx="1" fill="${palette.green}" class="bios-bar"/>`)}
  </g>`;
}

function typingEnd(command) {
  return typeStart + command.length * typeCharDuration;
}

function delayed(seconds, content) {
  return `<g class="boot" style="animation-delay:${seconds.toFixed(2)}s">${content}</g>`;
}

// SMIL keeps the reveal per-character; the opening command stays visible where SMIL is unsupported,
// while a delayed one (`begin` > 0) starts hidden.
function typedCommand(command, { x, y, size, id = "typed-command", begin = 0 }) {
  const charWidth = size * 0.6;
  const width = command.length * charWidth;
  // A short hold after the last keystroke: Chrome drops a discrete animation's final value when its key time is exactly 1.
  const total = typingEnd(command) + 0.3;
  const offsets = Array.from({ length: command.length + 1 }, (_, i) => i * charWidth);
  const keyTimes = [0, ...offsets.map((_, i) => (typeStart + i * typeCharDuration) / total)]
    .map((time) => time.toFixed(4)).join(";");
  const timing = `begin="${begin}s" dur="${total.toFixed(3)}s" calcMode="discrete" keyTimes="${keyTimes}" fill="freeze"`;
  return `<clipPath id="${id}"><rect x="${x}" y="${y - size}" width="${begin ? 0 : width.toFixed(1)}" height="${size * 1.5}">
    <animate attributeName="width" values="0;${offsets.map((offset) => offset.toFixed(1)).join(";")}" ${timing}/>
  </rect></clipPath>
  <text x="${x}" y="${y}" class="secondary" font-size="${size}" textLength="${width.toFixed(1)}" lengthAdjust="spacingAndGlyphs" clip-path="url(#${id})">${escapeXml(command)}</text>
  <rect x="${x}" y="${(y - size * 0.85).toFixed(1)}" width="${(charWidth * 0.9).toFixed(1)}" height="${size}" rx="1" fill="${palette.secondary}" opacity="0">
    <animate attributeName="x" values="${x};${offsets.map((offset) => (x + offset + 2).toFixed(1)).join(";")}" ${timing}/>
    <set attributeName="opacity" to="1" begin="${begin}s"/>
    <set attributeName="opacity" to="0" begin="${(begin + typingEnd(command) + 0.15).toFixed(2)}s"/>
  </rect>`;
}

function hideAt(seconds) {
  return seconds == null ? "" : `<set attributeName="visibility" to="hidden" begin="${seconds}s"/>`;
}

// After the visitor has lingered, the idle prompt runs a joke command and brews a steaming cup.
function easterEgg(config, { x, y, size }) {
  const egg = config.terminal.easterEgg;
  if (!egg?.command) return { markup: "", begin: null };
  const begin = Number(egg.after) || 25;
  const replyAt = begin + typingEnd(egg.command) + 0.5;
  const cupX = x + egg.command.length * size * 0.6 + 22;
  const cupY = y - 11;
  const steam = [0, 5, 10].map((dx, i) => `<path d="M${cupX + 2 + dx} ${cupY - 2}q-3 -4 0 -7q3 -3 0 -7" fill="none" stroke="${palette.secondary}" stroke-width="1.4" stroke-linecap="round" class="steam" style="animation-delay:${(i * 0.45).toFixed(2)}s"/>`).join("");
  const markup = `${typedCommand(egg.command, { x, y, size, id: "typed-egg", begin })}
  ${delayed(replyAt, `${steam}
  <path d="M${cupX} ${cupY}h14v6a6 6 0 0 1 -6 6h-2a6 6 0 0 1 -6 -6Z" fill="${palette.orange}"/>
  <path d="M${cupX + 14} ${cupY + 2}a3 3 0 0 1 0 6" fill="none" stroke="${palette.orange}" stroke-width="1.8"/>
  <text x="${cupX + 26}" y="${y}" class="label" font-size="${size - 2}">${escapeXml(egg.reply || "done")}</text>`)}`;
  return { markup, begin };
}

// The cards are rendered once per nightly sync, so the clock shows that moment and says so.
function syncClock(config, { cx, y, now = new Date() }) {
  const zone = config.terminal.timeZone;
  if (!zone) return "";
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(now).map((part) => [part.type, part.value]));
  const hour = Number(parts.hour);
  const city = config.profile.location?.split(",")[0] || zone;
  const label = `${city} ${parts.hour}:${parts.minute} · last sync`;
  const iconX = cx - (label.length * 14 * 0.6) / 2 - 14;
  const iconY = y - 5;
  const icon = hour >= 6 && hour < 18
    ? `<g class="sun"><circle cx="${iconX}" cy="${iconY}" r="3.6" fill="${palette.orange}"/>${Array.from({ length: 8 }, (_, i) => {
      const angle = i * Math.PI / 4;
      const point = (radius) => `${(iconX + Math.cos(angle) * radius).toFixed(2)} ${(iconY + Math.sin(angle) * radius).toFixed(2)}`;
      return `<path d="M${point(5.6)}L${point(7.6)}" stroke="${palette.orange}" stroke-width="1.4" stroke-linecap="round"/>`;
    }).join("")}</g>`
    : `<path d="M${iconX + 2} ${iconY - 6}a6 6 0 1 0 4 9.5a5 5 0 0 1 -4 -9.5Z" fill="${palette.blue}"/>`;
  return `${icon}
  <text x="${cx + 4}" y="${y}" text-anchor="middle" class="secondary" font-size="14">${escapeXml(label)}</text>`;
}

// Scanlines, a soft glow, and a slow sweeping beam make the portrait read as a warm CRT.
function crtPortrait(portrait, box, start) {
  const { x, y, width, height } = box;
  const beamHeight = 70;
  const glitchAt = start + glitchAfterPortrait;
  return `<defs>
    <filter id="crt-glow" x="-5%" y="-5%" width="110%" height="110%">
      <feGaussianBlur stdDeviation="2.2" result="blur"/>
      <feColorMatrix in="blur" type="matrix" values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 .55 0" result="halo"/>
      <feMerge><feMergeNode in="halo"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <pattern id="scanlines" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="1.6" fill="#000" opacity=".28"/></pattern>
    <linearGradient id="beam-fill" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${palette.cyan}" stop-opacity="0"/>
      <stop offset=".85" stop-color="${palette.cyan}" stop-opacity=".1"/>
      <stop offset="1" stop-color="${palette.cyan}" stop-opacity="0"/>
    </linearGradient>
    <clipPath id="crt-screen"><rect x="${x}" y="${y}" width="${width}" height="${height}"/></clipPath>
  </defs>
  <rect x="${x - 6}" y="${y - 6}" width="${width + 12}" height="${height + 12}" rx="8" fill="${palette.card}" class="screen"/>
  <g filter="url(#crt-glow)" class="rgb" style="animation-delay:${glitchAt.toFixed(2)}s">
    ${portraitText(portrait, box, start, glitchAt)}
  </g>
  <g clip-path="url(#crt-screen)" aria-hidden="true">
    <rect x="${x}" y="${y}" width="${width}" height="${height}" fill="url(#scanlines)"/>
    <rect x="${x}" y="${(y + height * 0.38).toFixed(1)}" width="${width}" height="3" fill="#d8fbff" class="tear" style="animation-delay:${glitchAt.toFixed(2)}s"/>
    <rect x="${x}" y="${(y + height * 0.71).toFixed(1)}" width="${width}" height="2" fill="#ffd6e0" class="tear" style="animation-delay:${(glitchAt + 0.25).toFixed(2)}s"/>
    <rect x="${x}" y="${y - beamHeight}" width="${width}" height="${beamHeight}" fill="url(#beam-fill)" class="beam" style="--beam-travel:${height + beamHeight}px;animation-delay:${start.toFixed(2)}s"/>
  </g>`;
}

// Horizontal bands of rows slip sideways by these fractions of the portrait width during a glitch.
const glitchShifts = [0, 0.035, -0.025, 0, 0.055, -0.04, 0.015, 0];

function portraitText(portrait, { x, y, width, height }, revealAt = 0, glitchAt = null) {
  const cellWidth = width / portrait.columns;
  const lineHeight = height / portrait.rows;
  const fontSize = cellWidth / 0.6;
  const rows = portrait.lines.map((line, rowIndex) => {
    const runs = [];
    let start = 0;
    while (start < line.chars.length) {
      const colorKey = line.colors[start];
      let end = start + 1;
      while (end < line.chars.length && line.colors[end] === colorKey) end += 1;
      const color = portrait.palette[Number(colorKey)] ?? palette.secondary;
      const chars = line.chars.slice(start, end);
      if (chars.trim()) {
        runs.push(`<tspan x="${(x + start * cellWidth).toFixed(3)}" fill="${escapeXml(color)}" textLength="${((end - start) * cellWidth).toFixed(3)}" lengthAdjust="spacingAndGlyphs">${escapeXml(chars)}</tspan>`);
      }
      start = end;
    }
    const delay = (revealAt + rowIndex * 0.018).toFixed(3);
    return `<text y="${(y + rowIndex * lineHeight + fontSize * 0.8).toFixed(3)}" class="boot" style="animation-delay:${delay}s" font-family="'Liberation Mono', 'Courier New', monospace" font-size="${fontSize.toFixed(3)}" font-weight="700" xml:space="preserve">${runs.join("")}</text>`;
  });
  if (glitchAt == null) return rows.join("\n    ");
  const bandSize = Math.ceil(rows.length / glitchShifts.length);
  return glitchShifts.map((shift, band) => {
    const content = rows.slice(band * bandSize, (band + 1) * bandSize).join("\n    ");
    return shift
      ? `<g class="glitch" style="--gx:${(shift * width).toFixed(1)}px;animation-delay:${glitchAt.toFixed(2)}s">${content}</g>`
      : content;
  }).join("\n    ");
}

function renderDesktop(config, stats, portrait) {
  const stackRows = Object.entries(config.stack).map(([label, values]) => ({
    label,
    value: values.join(" · ")
  }));
  const contacts = contactRows(config).slice(0, 3);
  const metrics = statRows(stats).slice(0, 4);

  const booted = biosDuration + typingEnd(config.terminal.command) + 0.1;
  const ascii = crtPortrait(portrait, { x: 30, y: 132, width: 396, height: 396 }, booted);

  const system = systemRows(config, stats).slice(0, 5).map((row, index) => desktopRow({
    ...row,
    y: 168 + index * 22
  })).join("\n    ");
  const playing = nowPlayingBlock(nowPlaying(config), { x: 38, y: 562, width: 390 });
  const egg = easterEgg(config, { x: 60, y: 632, size: 16 });

  const stack = stackRows.slice(0, 3).map((row, index) => desktopRow({
    ...row,
    y: 308 + index * 24
  })).join("\n    ");

  const current = config.currently.slice(0, 3).map((row, index) => desktopRow({
    ...row,
    y: 446 + index * 24
  })).join("\n    ");

  const contact = contacts.map((row, index) => desktopRow({
    ...row,
    y: 584 + index * 22,
    labelX: 488,
    leaderX: 570,
    valueX: 792,
    max: 25
  })).join("\n    ");

  const github = metrics.map((row, index) => desktopRow({
    ...row,
    y: 584 + index * 22,
    labelX: 830,
    leaderX: 952,
    valueX: 1144,
    max: 12
  })).join("\n    ");

  const content = `${syncClock(config, { cx: 600, y: 47 })}
  <text x="${1200 - 40}" y="47" text-anchor="end" class="secondary" font-size="15">${escapeXml(config.terminal.path)}</text>
  <text x="38" y="112" class="accent" font-size="16">$</text>
  ${typedCommand(config.terminal.command, { x: 60, y: 112, size: 16, begin: biosDuration })}
  ${ascii}
  ${delayed(booted + 1.8, playing)}
  ${delayed(booted + 2, `<text x="38" y="632" class="accent" font-size="16">$</text>
  <rect x="60" y="618" width="10" height="16" rx="1" fill="${palette.secondary}" class="blink" style="animation-delay:${(booted + 2.6).toFixed(2)}s">${hideAt(egg.begin)}</rect>`)}
  ${egg.markup}

  ${delayed(booted, `<text x="472" y="112" class="accent" font-size="19" font-weight="700">${escapeXml(config.profile.username)}</text>
  <text x="${472 + config.profile.username.length * 11.4}" y="112" class="secondary" font-size="19">@github</text>
  <line x1="472" y1="128" x2="1144" y2="128" stroke="${palette.blue}" stroke-opacity=".65"/>`)}

  ${delayed(booted + 0.25, `${sectionHeading("System", 148)}
  ${system}`)}
  ${delayed(booted + 0.5, `${sectionHeading("Stack", 286)}
  ${stack}`)}
  ${delayed(booted + 0.75, `${sectionHeading("Currently", 424)}
  ${current}`)}

  ${delayed(booted + 1, `<text x="472" y="558" class="section" font-size="15">Contact</text>
  <line x1="568" y1="553" x2="792" y2="553" class="rule"/>
  ${contact}`)}
  ${delayed(booted + 1.15, `<text x="814" y="558" class="section" font-size="15">GitHub</text>
  <line x1="910" y1="553" x2="1144" y2="553" class="rule"/>
  ${github}`)}
  ${biosScreen(config, { width: 1200, height: 680 })}`;

  return svgShell({
    width: 1200,
    height: 680,
    title: `${config.profile.username} terminal profile`,
    chromeTitle: config.terminal.title,
    description: `A terminal-inspired profile for ${config.profile.name}, with system, stack, current focus, contact, and public GitHub statistics.`,
    content
  });
}

function mobileRow({ label, value, y, max = 46 }) {
  const safeValue = truncate(value, max);
  const valueX = 642;
  const estimatedWidth = safeValue.length * 8.25;
  const leaderEnd = Math.max(190, valueX - estimatedWidth - 14);
  return `<text x="38" y="${y}" class="label" font-size="15">${escapeXml(label)}</text>
    <line x1="170" y1="${y - 5}" x2="${leaderEnd.toFixed(1)}" y2="${y - 5}" class="leader"/>
    <text x="${valueX}" y="${y}" text-anchor="end" class="value" font-size="15">${escapeXml(safeValue)}</text>`;
}

function mobileHeading(title, y) {
  return `<text x="38" y="${y}" class="section" font-size="14.5">${escapeXml(title)}</text>
    <line x1="148" y1="${y - 5}" x2="642" y2="${y - 5}" class="rule"/>`;
}

function renderMobile(config, stats, portrait) {
  const stackRows = Object.entries(config.stack).map(([label, values]) => ({
    label,
    value: values.join(" · ")
  }));
  const booted = biosDuration + typingEnd(config.terminal.command) + 0.1;
  const compactAscii = crtPortrait(portrait, { x: 184, y: 112, width: 312, height: 312 }, booted);

  const system = systemRows(config, stats).slice(0, 5).map((row, index) => mobileRow({
    ...row,
    y: 500 + index * 22
  })).join("\n    ");
  const playing = nowPlayingBlock(nowPlaying(config), { x: 38, y: 1080, width: 604, mobile: true });
  const egg = easterEgg(config, { x: 60, y: 1146, size: 15 });
  const stack = stackRows.slice(0, 3).map((row, index) => mobileRow({
    ...row,
    y: 640 + index * 23
  })).join("\n    ");
  const current = config.currently.slice(0, 3).map((row, index) => mobileRow({
    ...row,
    y: 755 + index * 23
  })).join("\n    ");
  const contacts = contactRows(config).slice(0, 2).map((row, index) => mobileRow({
    ...row,
    y: 870 + index * 23,
    max: 42
  })).join("\n    ");
  const metrics = statRows(stats).slice(0, 4).map((row, index) => mobileRow({
    ...row,
    y: 962 + index * 23,
    max: 20
  })).join("\n    ");

  const content = `${syncClock(config, { cx: 352, y: 47 })}
  <text x="642" y="47" text-anchor="end" class="secondary" font-size="14">${escapeXml(config.terminal.path)}</text>
  <text x="38" y="100" class="accent" font-size="15">$</text>
  ${typedCommand(config.terminal.command, { x: 60, y: 100, size: 15, begin: biosDuration })}
  ${compactAscii}
  ${delayed(booted + 1.2, `<text x="38" y="444" class="accent" font-size="18" font-weight="700">${escapeXml(config.profile.username)}</text>
  <text x="${38 + config.profile.username.length * 10.8}" y="444" class="secondary" font-size="18">@github</text>
  <line x1="38" y1="460" x2="642" y2="460" stroke="${palette.blue}" stroke-opacity=".65"/>`)}
  ${delayed(booted + 1.4, `${mobileHeading("System", 480)}
  ${system}`)}
  ${delayed(booted + 1.6, `${mobileHeading("Stack", 618)}
  ${stack}`)}
  ${delayed(booted + 1.8, `${mobileHeading("Currently", 733)}
  ${current}`)}
  ${delayed(booted + 2, `${mobileHeading("Contact", 848)}
  ${contacts}`)}
  ${delayed(booted + 2.2, `${mobileHeading("GitHub", 940)}
  ${metrics}`)}
  ${delayed(booted + 2.4, playing)}
  ${delayed(booted + 2.6, `<text x="38" y="1146" class="accent" font-size="15">$</text>
  <rect x="60" y="1133" width="9" height="15" rx="1" fill="${palette.secondary}" class="blink" style="animation-delay:${(booted + 3.2).toFixed(2)}s">${hideAt(egg.begin)}</rect>`)}
  ${egg.markup}
  ${biosScreen(config, { width: 680, height: 1176 })}`;

  return svgShell({
    width: 680,
    height: 1176,
    title: `${config.profile.username} terminal profile`,
    chromeTitle: config.terminal.title,
    description: `A mobile terminal-inspired profile for ${config.profile.name}.`,
    content
  });
}

function renderReadme(config) {
  const stackAlt = Object.entries(config.stack).map(([label, items]) => `${label}: ${items.join(", ")}`).join(". ");
  const extraContacts = [
    ["Website", config.contact.website],
    ["LinkedIn", config.contact.linkedin],
    ["Email", config.contact.email ? `mailto:${config.contact.email}` : ""]
  ].filter(([, url]) => url).map(([label, url]) => `<a href="${escapeXml(url)}">${label}</a>`).join(" · ");

  return `<!-- Generated from profile.config.json by scripts/update-profile.mjs. -->
<picture>
  <source media="(max-width: 640px)" srcset="./assets/profile-terminal-mobile.svg">
  <img src="./assets/profile-terminal.svg" width="100%" alt="Terminal profile for ${escapeXml(config.profile.name)}">
</picture>

${engineeringPicture("engineering-stack", stackAlt)}

${engineeringPicture("language-prism", "The dark side of the code: public code split by language, drawn as a beam of light through a prism")}

${engineeringPicture("profile-notes", `${config.profile.name}. ${config.profile.role}, ${config.profile.location}. ${config.profile.statement}`)}
${favoritesMarkdown(config)}
<a href="https://github.com/${encodeURIComponent(config.profile.username)}">
${engineeringPicture("profile-connect", `Connect with ${config.profile.name} on GitHub: @${config.profile.username}`)}
</a>
${extraContacts ? `\n${extraContacts}\n` : ""}`;
}

async function main() {
  const config = JSON.parse(await readFile(configPath, "utf8"));
  const portrait = JSON.parse(await readFile(portraitPath, "utf8"));
  assertConfig(config);
  assertPortrait(portrait);
  await mkdir(assetsDir, { recursive: true });
  await Promise.all([writeFavoritesAssets(config), writeEngineeringAssets(config)]);

  if (readmeOnly) {
    await writeFile(readmePath, renderReadme(config), "utf8");
    console.log("Rendered README and visual sections without refreshing profile statistics.");
    return;
  }

  let stats = { ...config.statsFallback };
  let liveStatsAvailable = false;

  if (!offline) {
    try {
      const liveStats = await fetchPublicStats(config.profile.username);
      stats = Object.fromEntries(
        Object.entries({ ...stats, ...liveStats }).map(([key, value]) => [
          key,
          value ?? stats[key] ?? null
        ])
      );
      liveStatsAvailable = true;
      console.log(`Fetched public GitHub stats for ${config.profile.username}.`);
    } catch (error) {
      console.warn(`Live stats unavailable: ${error.message}`);
      if (await fileExists(desktopSvgPath)) {
        console.warn("Keeping the last valid committed SVG fallback unchanged.");
        await writeFile(readmePath, renderReadme(config), "utf8");
        return;
      }
    }
  }

  await mkdir(assetsDir, { recursive: true });
  await Promise.all([
    writeFile(desktopSvgPath, renderDesktop(config, stats, portrait), "utf8"),
    writeFile(mobileSvgPath, renderMobile(config, stats, portrait), "utf8"),
    writeFile(readmePath, renderReadme(config), "utf8"),
    writePrismAssets(stats.languages, stats.languageRepos),
    // Re-rendered with live data: one pair of marching hammers per public repository.
    writeFavoritesAssets(config, stats.repositories)
  ]);

  console.log(
    `Rendered README and terminal assets using ${liveStatsAvailable ? "live" : "fallback"} statistics.`
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
