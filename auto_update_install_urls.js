const fs = require("fs");
const got = require("got");
const yaml = require("js-yaml");

const MAP_PATH = "library_installation_urls.json";
const LIBS_PATH = "src/libraries.json";
const LOCAL_LIBRARIES_PATH = "local_libraries.json";
const GITHUB_API_BASE = "https://api.github.com/repos/processing/p5.js-website/contents";
const LIBRARIES_CONTENT_PATH = "src/content/libraries/en";
const REQUEST_HEADERS = { "user-agent": "p5-vscode-install-url-sync" };

function normalizeKey(str) {
  return String(str || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function uniq(arr) {
  return [...new Set(arr.filter(Boolean))];
}

function asArray(value) {
  return Array.isArray(value) ? value : value ? [value] : [];
}

function limitConcurrency(max) {
  let active = 0;
  const queue = [];

  const next = () => {
    if (active >= max || queue.length === 0) {
      return;
    }
    active++;
    const { fn, resolve, reject } = queue.shift();
    fn()
      .then(resolve)
      .catch(reject)
      .finally(() => {
        active--;
        next();
      });
  };

  return (fn) =>
    new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      next();
    });
}

async function fetchText(url) {
  const resp = await got(url, {
    headers: REQUEST_HEADERS,
    throwHttpErrors: false,
    timeout: { request: 12000 },
    retry: { limit: 1 },
    followRedirect: true,
  });
  if (resp.statusCode < 200 || resp.statusCode >= 300) {
    return null;
  }
  return resp.body;
}

function looksLikeHtml(text) {
  const t = String(text || "").trim().slice(0, 500).toLowerCase();
  return t.startsWith("<!doctype html") || t.startsWith("<html") || t.includes("<head") || t.includes("<body");
}

function looksLikeJavaScript(text) {
  const t = String(text || "").trim().slice(0, 800);
  if (!t) {
    return false;
  }
  if (/^\s*<\/?html/i.test(t)) {
    return false;
  }
  return (
    /\b(function|var|let|const|class|export|import)\b/.test(t) ||
    /=>/.test(t) ||
    /\/\*/.test(t) ||
    /;\s*$/.test(t)
  );
}

function isBlockedHost(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return [
      "github.githubassets.com",
      "githubassets.com",
      "google-analytics.com",
      "www.google-analytics.com",
      "googletagmanager.com",
      "www.googletagmanager.com",
    ].some((blocked) => host === blocked || host.endsWith(`.${blocked}`));
  } catch {
    return true;
  }
}

async function isInstallUrlValid(url) {
  if (!url || typeof url !== "string") {
    return false;
  }
  if (!/^https?:\/\//i.test(url)) {
    return false;
  }
  if (isBlockedHost(url)) {
    return false;
  }

  try {
    const resp = await got(url, {
      headers: REQUEST_HEADERS,
      throwHttpErrors: false,
      timeout: { request: 12000 },
      retry: { limit: 1 },
      followRedirect: true,
      responseType: "text",
    });

    if (resp.statusCode < 200 || resp.statusCode >= 300) {
      return false;
    }

    const contentType = String(resp.headers["content-type"] || "").toLowerCase();
    const body = String(resp.body || "");

    if (contentType.includes("javascript")) {
      return true;
    }

    if (/\.m?js($|\?|#)/i.test(url) && !looksLikeHtml(body) && looksLikeJavaScript(body)) {
      return true;
    }

    if (/cdn\.jsdelivr\.net\/npm\//i.test(url) || /unpkg\.com\//i.test(url)) {
      return !looksLikeHtml(body) && looksLikeJavaScript(body);
    }

    return false;
  } catch {
    return false;
  }
}

function extractGitHubRepo(url) {
  if (!url) {
    return null;
  }
  const m = String(url).match(/github\.com\/([^/]+)\/([^/#?]+)/i);
  if (!m) {
    return null;
  }
  const owner = m[1];
  const repo = m[2].replace(/\.git$/i, "");
  if (!owner || !repo) {
    return null;
  }
  return { owner, repo };
}

function nameVariants(entry, repoName) {
  const n = entry.name || "";
  const variants = [
    n,
    n.replace(/\s+/g, ""),
    n.toLowerCase(),
    n.replace(/^p5\./i, ""),
    n.replace(/^p5/i, ""),
    repoName || "",
    (repoName || "").toLowerCase(),
  ]
    .map((v) => String(v).trim())
    .filter(Boolean)
    .map((v) => v.replace(/[^a-zA-Z0-9._-]/g, ""));

  return uniq(variants);
}

function buildGitHubGuesses(entry, owner, repo) {
  const dirs = ["", "dist/", "lib/", "build/", "release/", "library/", "libraries/", "js/"];
  const branches = ["main", "master"];
  const vars = nameVariants(entry, repo);
  const files = [];

  for (const v of vars) {
    files.push(`${v}.js`, `${v}.min.js`);
  }

  files.push("index.js", `dist/${repo}.js`, `dist/${repo}.min.js`);

  const candidates = [];
  for (const b of branches) {
    for (const f of uniq(files)) {
      for (const d of dirs) {
        const p = `${d}${f}`.replace(/^dist\/dist\//, "dist/");
        candidates.push(`https://raw.githubusercontent.com/${owner}/${repo}/${b}/${p}`);
      }
    }
  }
  return uniq(candidates);
}

function extractLikelyScriptLinks(html) {
  const links = [];
  const re = /https?:\/\/[^\"'\s)<>]+/gi;
  const allowedHosts = [
    "unpkg.com",
    "cdn.jsdelivr.net",
    "raw.githubusercontent.com",
    "github.com",
    "rawgit.com",
  ];
  const blockedHosts = [
    "github.githubassets.com",
    "githubassets.com",
    "google-analytics.com",
    "www.google-analytics.com",
    "googletagmanager.com",
    "www.googletagmanager.com",
  ];
  let m;
  while ((m = re.exec(html)) !== null) {
    const u = m[0];
    let host = "";
    try {
      host = new URL(u).hostname.toLowerCase();
    } catch {
      continue;
    }
    if (blockedHosts.some((blocked) => host === blocked || host.endsWith(`.${blocked}`))) {
      continue;
    }
    if (!allowedHosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))) {
      continue;
    }
    if (
      /\.m?js($|\?|#)/i.test(u) ||
      /unpkg\.com\//i.test(u) ||
      /cdn\.jsdelivr\.net\//i.test(u) ||
      /raw\.githubusercontent\.com\//i.test(u) ||
      /rawgit\.com\//i.test(u)
    ) {
      links.push(u.replace(/[),.;]+$/, ""));
    }
  }
  return uniq(links);
}

async function npmCandidates(npmName) {
  const out = [];
  if (!npmName) {
    return out;
  }

  const pkgJsonUrl = `https://unpkg.com/${npmName}/package.json`;
  const body = await fetchText(pkgJsonUrl);
  if (body) {
    try {
      const pkg = JSON.parse(body);
      const fields = [pkg.unpkg, pkg.jsdelivr, pkg.browser, pkg.module, pkg.main];
      for (const f of fields) {
        if (typeof f === "string" && /\.m?js($|\?|#)/i.test(f)) {
          const clean = f.replace(/^\.\//, "");
          out.push(`https://unpkg.com/${npmName}/${clean}`);
          out.push(`https://cdn.jsdelivr.net/npm/${npmName}/${clean}`);
        }
      }
    } catch {
      // ignore malformed package.json payloads
    }
  }

  out.push(`https://unpkg.com/${npmName}`);
  out.push(`https://cdn.jsdelivr.net/npm/${npmName}`);

  return uniq(out);
}

function readLocalLibraries() {
  if (!fs.existsSync(LOCAL_LIBRARIES_PATH)) {
    return [];
  }

  try {
    const raw = fs.readFileSync(LOCAL_LIBRARIES_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function fetchUpstreamLibraryMetadata() {
  const listUrl = `${GITHUB_API_BASE}/${LIBRARIES_CONTENT_PATH}`;
  const files = await got(listUrl, { headers: REQUEST_HEADERS }).json();
  const yamlFiles = files.filter((f) => f && f.type === "file" && f.name.endsWith(".yaml"));

  const out = [];
  for (const file of yamlFiles) {
    const raw = await got(file.download_url, { headers: REQUEST_HEADERS }).text();
    const entry = yaml.load(raw);
    if (!entry || !entry.name) {
      continue;
    }
    out.push({
      name: entry.name,
      npm: entry.npm || null,
      sourceUrl: entry.sourceUrl || null,
      websiteUrl: entry.websiteUrl || null,
    });
  }

  const localLibraries = readLocalLibraries();
  for (const library of localLibraries) {
    if (!library || !library.name) {
      continue;
    }
    if (!out.some((entry) => entry.name === library.name)) {
      out.push({
        name: library.name,
        npm: library.npm || null,
        sourceUrl: library.sourceUrl || library.url || null,
        websiteUrl: library.websiteUrl || library.url || null,
      });
    }
  }

  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

async function chooseInstallUrl(entry, existingValue) {
  const existingUrls = asArray(existingValue);
  if (existingUrls.length) {
    const okAll = (await Promise.all(existingUrls.map((u) => isInstallUrlValid(u)))).every(Boolean);
    if (okAll) {
      return Array.isArray(existingValue) ? existingUrls : existingUrls[0];
    }
  }

  const candidates = [];

  const npmUrls = await npmCandidates(entry.npm);
  candidates.push(...npmUrls);

  const projectPages = uniq([entry.websiteUrl, entry.sourceUrl]);
  for (const pageUrl of projectPages) {
    const html = await fetchText(pageUrl);
    if (html) {
      candidates.push(...extractLikelyScriptLinks(html));
    }
  }

  const gh = extractGitHubRepo(entry.sourceUrl) || extractGitHubRepo(entry.websiteUrl);
  if (gh) {
    candidates.push(...buildGitHubGuesses(entry, gh.owner, gh.repo));
  }

  const ordered = uniq(candidates).slice(0, 120);

  for (const candidate of ordered) {
    if (await isInstallUrlValid(candidate)) {
      return candidate;
    }
  }

  return null;
}

async function main() {
  const currentMap = JSON.parse(fs.readFileSync(MAP_PATH, "utf8"));
  const generatedLibs = JSON.parse(fs.readFileSync(LIBS_PATH, "utf8"));
  const generatedSet = new Set(generatedLibs.map((l) => l.name));

  const upstream = await fetchUpstreamLibraryMetadata();
  const byName = new Map(upstream.map((e) => [e.name, e]));
  const byNorm = new Map(upstream.map((e) => [normalizeKey(e.name), e]));
  const localLibraries = readLocalLibraries();
  const localByName = new Map(localLibraries.map((entry) => [entry.name, entry]));

  const nextMap = { "p5.sound": null };
  const limit = limitConcurrency(4);

  const baseResults = await Promise.all(
    [...generatedSet]
      .sort((a, b) => a.localeCompare(b))
      .map((name) =>
        limit(async () => {
          const meta = byName.get(name) || byNorm.get(normalizeKey(name)) || { name };
          const existing = Object.prototype.hasOwnProperty.call(currentMap, name)
            ? currentMap[name]
            : null;
          const install = await chooseInstallUrl(meta, existing);
          return { name, install };
        })
      )
  );

  for (const { name, install } of baseResults) {
    nextMap[name] = install;
  }

  const localResults = await Promise.all(
    localLibraries
      .filter((entry) => entry && entry.name)
      .map((entry) =>
        limit(async () => {
          const existing = Object.prototype.hasOwnProperty.call(currentMap, entry.name)
            ? currentMap[entry.name]
            : entry.install || null;
          const install = await chooseInstallUrl(
            { name: entry.name, npm: entry.npm || null, sourceUrl: entry.sourceUrl || entry.url || null, websiteUrl: entry.websiteUrl || entry.url || null },
            existing
          );
          return { name: entry.name, install: install || entry.install || null };
        })
      )
  );

  for (const { name, install } of localResults) {
    nextMap[name] = install;
  }

  fs.writeFileSync(MAP_PATH, JSON.stringify(nextMap, null, 2) + "\n");

  const withInstall = Object.entries(nextMap).filter(([k, v]) => k !== "p5.sound" && v).length;
  const withoutInstall = Object.entries(nextMap).filter(([k, v]) => k !== "p5.sound" && !v).length;

  console.log(`Updated ${MAP_PATH}`);
  console.log(`Installable: ${withInstall}`);
  console.log(`Needs manual: ${withoutInstall}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
