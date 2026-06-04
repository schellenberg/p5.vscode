const fs = require('fs');
const path = require('path');
const got = require('got');

const version = process.argv[2] || '2.3.0';
const definitelyTypedVersion = process.argv[3] || '1.7.7';
const outDir = path.join(__dirname, 'p5types');

async function fetchTypeFile(fileName) {
  const url = `https://unpkg.com/p5@${version}/types/${fileName}`;
  const body = await got(url, {
    timeout: { request: 20000 },
    followRedirect: true,
    retry: { limit: 2 }
  }).text();
  return { url, body };
}

async function fetchP5SoundTypeFile() {
  const url = `https://unpkg.com/@types/p5@${definitelyTypedVersion}/lib/addons/p5.sound.d.ts`;
  const rawBody = await got(url, {
    timeout: { request: 20000 },
    followRedirect: true,
    retry: { limit: 2 }
  }).text();

  // The @types file augments ../../index; retarget to our bundled ./p5 module.
  const body = rawBody.replace(/\.\.\/\.\.\/index/g, './p5');
  return { url, body };
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });

  const files = ['p5.d.ts', 'global.d.ts'];
  for (const fileName of files) {
    const { url, body } = await fetchTypeFile(fileName);
    const outPath = path.join(outDir, fileName);
    fs.writeFileSync(outPath, body, 'utf8');
    console.log(`Updated ${fileName} from ${url}`);
  }

  const sound = await fetchP5SoundTypeFile();
  fs.writeFileSync(path.join(outDir, 'p5.sound.d.ts'), sound.body, 'utf8');
  console.log(`Updated p5.sound.d.ts from ${sound.url}`);

  console.log(
    `Done. p5 core types are synced to p5@${version} and p5.sound types to @types/p5@${definitelyTypedVersion}.`
  );
}

main().catch((err) => {
  console.error('Failed to update p5 types:', err.message || err);
  process.exit(1);
});
