const fs = require("fs");
const got = require("got");
const yaml = require("js-yaml");
const libraryInstallURLS = require("./library_installation_urls.json");

// Downloads contributor library info from the p5.js-website content collection
// and generates a JSON file with metadata plus install URLs from this repo.

const githubApiBase = "https://api.github.com/repos/processing/p5.js-website/contents";
const librariesContentPath = "src/content/libraries/en";
const localLibrariesPath = "local_libraries.json";
const librariesDirectoryUrl = "https://beta.p5js.org/libraries/directory/";
// const librariesDirectoryUrl = "https://p5js.org/libraries/directory/";
const requestHeaders = {
  "user-agent": "p5-vscode-library-sync",
};

function normalizeKey(str) {
  return String(str || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function normalizeHtmlForSearch(str) {
  return String(str || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function mapAuthors(author) {
  if (!author) {
    return [];
  }
  const arr = Array.isArray(author) ? author : [author];
  return arr
    .map((a) => ({
      name: a && a.name ? a.name : "",
      ...(a && a.url ? { url: a.url } : {}),
    }))
    .filter((a) => a.name);
}

function pickLibraryUrl(entry) {
  return entry.websiteUrl || entry.sourceUrl || "";
}

function readLocalLibraries() {
  if (!fs.existsSync(localLibrariesPath)) {
    return [];
  }

  try {
    const raw = fs.readFileSync(localLibrariesPath, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function mergeLibraries(generatedLibraries, localLibraries) {
  const byName = new Map();

  for (const library of generatedLibraries) {
    byName.set(library.name, library);
  }

  for (const library of localLibraries) {
    if (!library || !library.name) {
      continue;
    }
    byName.set(library.name, {
      name: library.name,
      url: library.url || library.websiteUrl || library.sourceUrl || "",
      authors: library.authors || (library.author ? mapAuthors(library.author) : []),
      desc: library.desc || library.description || "",
      install: library.install || null,
    });
  }

  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

async function main() {
  const out = [];
  const localLibraries = readLocalLibraries();
  const directoryHtml = normalizeHtmlForSearch(
    (await got(librariesDirectoryUrl, { headers: requestHeaders }).text()) || ""
  );

  const installByExact = new Map();
  const installByNormalized = new Map();
  for (const [name, install] of Object.entries(libraryInstallURLS)) {
    installByExact.set(name, install);
    installByNormalized.set(normalizeKey(name), install);
  }

  const listUrl = `${githubApiBase}/${librariesContentPath}`;
  const files = await got(listUrl, { headers: requestHeaders }).json();
  const yamlFiles = files.filter((f) => f && f.type === "file" && f.name.endsWith(".yaml"));

  for (const file of yamlFiles) {
    const raw = await got(file.download_url, { headers: requestHeaders }).text();
    const entry = yaml.load(raw);
    if (!entry || !entry.name) {
      continue;
    }

    if (entry.name === "p5.sound") {
      continue;
    }

    if (!directoryHtml.includes(normalizeHtmlForSearch(entry.name))) {
      continue;
    }

    const install =
      installByExact.get(entry.name) ||
      installByNormalized.get(normalizeKey(entry.name)) ||
      null;

    out.push({
      name: entry.name,
      url: pickLibraryUrl(entry),
      authors: mapAuthors(entry.author),
      desc: entry.description || "",
      install,
    });
  }

  const merged = mergeLibraries(out, localLibraries);
  fs.writeFileSync("src/libraries.json", JSON.stringify(merged, null, 2));
}

main();
