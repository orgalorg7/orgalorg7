#!/usr/bin/env node

import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");
const configPath = path.join(rootDir, "profile.config.json");
const assetsDir = path.join(rootDir, "assets");
const desktopSvgPath = path.join(assetsDir, "profile-terminal.svg");
const mobileSvgPath = path.join(assetsDir, "profile-terminal-mobile.svg");
const readmePath = path.join(rootDir, "README.md");

const offline = process.argv.includes("--offline");
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

function escapeMarkdown(value) {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", " ").trim();
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
    contributions
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

function systemRows(config) {
  return [
    { label: "Role", value: config.profile.role },
    ...(config.profile.location ? [{ label: "Base", value: config.profile.location }] : []),
    ...config.system
  ];
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

function renderDesktop(config, stats) {
  const stackRows = Object.entries(config.stack).map(([label, values]) => ({
    label,
    value: values.join(" · ")
  }));
  const contacts = contactRows(config).slice(0, 3);
  const metrics = statRows(stats).slice(0, 4);

  const ascii = config.terminal.ascii.slice(0, 21).map((line, index) =>
    `<text x="38" y="${150 + index * 20}" class="primary" font-size="16" opacity=".78" xml:space="preserve">${escapeXml(line)}</text>`
  ).join("\n    ");

  const system = systemRows(config).slice(0, 4).map((row, index) => desktopRow({
    ...row,
    y: 170 + index * 24
  })).join("\n    ");

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

  const content = `<text x="${1200 - 40}" y="47" text-anchor="end" class="secondary" font-size="15">${escapeXml(config.terminal.path)}</text>
  <text x="38" y="112" class="accent" font-size="16">$</text>
  <text x="60" y="112" class="secondary" font-size="16">${escapeXml(config.terminal.command)}</text>
  ${ascii}
  <text x="38" y="632" class="accent" font-size="16">$</text>
  <rect x="60" y="618" width="10" height="16" rx="1" fill="${palette.secondary}"/>

  <text x="472" y="112" class="accent" font-size="19" font-weight="700">${escapeXml(config.profile.username)}</text>
  <text x="${472 + config.profile.username.length * 11.4}" y="112" class="secondary" font-size="19">@github</text>
  <line x1="472" y1="128" x2="1144" y2="128" stroke="${palette.blue}" stroke-opacity=".65"/>

  ${sectionHeading("System", 148)}
  ${system}
  ${sectionHeading("Stack", 286)}
  ${stack}
  ${sectionHeading("Currently", 424)}
  ${current}

  <text x="472" y="558" class="section" font-size="15">Contact</text>
  <line x1="568" y1="553" x2="792" y2="553" class="rule"/>
  ${contact}
  <text x="814" y="558" class="section" font-size="15">GitHub</text>
  <line x1="910" y1="553" x2="1144" y2="553" class="rule"/>
  ${github}`;

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

function renderMobile(config, stats) {
  const stackRows = Object.entries(config.stack).map(([label, values]) => ({
    label,
    value: values.join(" · ")
  }));
  const compactAscii = config.terminal.ascii.slice(0, 21).map((line, index) =>
    `<text x="160" y="${126 + index * 14}" class="primary" font-size="13" opacity=".78" xml:space="preserve">${escapeXml(line)}</text>`
  ).join("\n    ");

  const system = systemRows(config).slice(0, 4).map((row, index) => mobileRow({
    ...row,
    y: 502 + index * 23
  })).join("\n    ");
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

  const content = `<text x="642" y="47" text-anchor="end" class="secondary" font-size="14">${escapeXml(config.terminal.path)}</text>
  <text x="38" y="100" class="accent" font-size="15">$</text>
  <text x="60" y="100" class="secondary" font-size="15">${escapeXml(config.terminal.command)}</text>
  ${compactAscii}
  <text x="38" y="444" class="accent" font-size="18" font-weight="700">${escapeXml(config.profile.username)}</text>
  <text x="${38 + config.profile.username.length * 10.8}" y="444" class="secondary" font-size="18">@github</text>
  <line x1="38" y1="460" x2="642" y2="460" stroke="${palette.blue}" stroke-opacity=".65"/>
  ${mobileHeading("System", 480)}
  ${system}
  ${mobileHeading("Stack", 618)}
  ${stack}
  ${mobileHeading("Currently", 733)}
  ${current}
  ${mobileHeading("Contact", 848)}
  ${contacts}
  ${mobileHeading("GitHub", 940)}
  ${metrics}
  <text x="38" y="1070" class="accent" font-size="15">$</text>
  <rect x="60" y="1057" width="9" height="15" rx="1" fill="${palette.secondary}"/>`;

  return svgShell({
    width: 680,
    height: 1100,
    title: `${config.profile.username} terminal profile`,
    chromeTitle: config.terminal.title,
    description: `A mobile terminal-inspired profile for ${config.profile.name}.`,
    content
  });
}

function renderReadme(config) {
  const stackRows = Object.entries(config.stack)
    .filter(([, values]) => Array.isArray(values) && values.length)
    .map(([label, values]) => `| ${escapeMarkdown(label)} | ${values.map(escapeMarkdown).join(" · ")} |`)
    .join("\n");

  const projects = (config.projects ?? []).filter((project) =>
    project?.name && project?.description && project?.url
  );

  const projectSection = projects.length
    ? `\n## Selected work\n\n${projects.slice(0, 4).map((project) => {
        const tech = Array.isArray(project.tech) && project.tech.length
          ? `\n\n${project.tech.map((item) => `\`${escapeMarkdown(item)}\``).join(" ")}`
          : "";
        return `### [${escapeMarkdown(project.name)}](${project.url})\n\n${escapeMarkdown(project.description)}${tech}`;
      }).join("\n\n---\n\n")}\n`
    : "";

  const contacts = [];
  if (config.contact.github) contacts.push(`[GitHub](https://github.com/${config.profile.username})`);
  if (config.contact.website) contacts.push(`[Website](${config.contact.website})`);
  if (config.contact.linkedin) contacts.push(`[LinkedIn](${config.contact.linkedin})`);
  if (config.contact.email) contacts.push(`[Email](mailto:${config.contact.email})`);

  return `<!-- Generated from profile.config.json by scripts/update-profile.mjs. -->
<picture>
  <source media="(max-width: 640px)" srcset="./assets/profile-terminal-mobile.svg">
  <img src="./assets/profile-terminal.svg" width="100%" alt="Terminal profile for ${escapeMarkdown(config.profile.name)}">
</picture>

> ${escapeMarkdown(config.profile.statement)}

## Core stack

| Area | Working set |
|:--|:--|
${stackRows}
${projectSection}
## Connect

${contacts.join(" · ")}
`;
}

async function main() {
  const config = JSON.parse(await readFile(configPath, "utf8"));
  assertConfig(config);

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
    writeFile(desktopSvgPath, renderDesktop(config, stats), "utf8"),
    writeFile(mobileSvgPath, renderMobile(config, stats), "utf8"),
    writeFile(readmePath, renderReadme(config), "utf8")
  ]);

  console.log(
    `Rendered README and terminal assets using ${liveStatsAvailable ? "live" : "fallback"} statistics.`
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
