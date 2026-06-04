#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const repoRoot = process.cwd();
const sitesDir = path.join(repoRoot, 'sites');

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function copyFile(source, target, mode) {
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.copyFile(source, target);
  if (mode) await fs.chmod(target, mode);
}

async function readSites() {
  if (!await pathExists(sitesDir)) return [];
  const entries = await fs.readdir(sitesDir, { withFileTypes: true });
  const sites = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const siteJsonPath = path.join(sitesDir, entry.name, 'site.json');
    if (!await pathExists(siteJsonPath)) continue;

    const site = JSON.parse(await fs.readFile(siteJsonPath, 'utf8'));
    if (!site.id || site.id !== entry.name) {
      throw new Error(`sites/${entry.name}/site.json must include matching id "${entry.name}".`);
    }
    if (!Array.isArray(site.matches) || site.matches.length === 0) {
      throw new Error(`sites/${entry.name}/site.json must include a non-empty matches array.`);
    }

    const adapterSource = path.join(sitesDir, entry.name, 'adapter.js');
    if (await pathExists(adapterSource)) {
      const adapterTarget = path.join(repoRoot, 'dist', 'extension', 'sites', entry.name, 'adapter.js');
      await copyFile(adapterSource, adapterTarget);
      site.adapterScript = `sites/${entry.name}/adapter.js`;
    }

    sites.push(site);
  }

  sites.sort((a, b) => a.id.localeCompare(b.id));
  return sites;
}

function unique(values) {
  return [...new Set(values)];
}

const sites = await readSites();
if (sites.length === 0) {
  throw new Error('At least one site folder with site.json is required under sites/.');
}

const matches = unique(sites.flatMap(site => site.matches));
const extraHostPermissions = unique(sites.flatMap(site => site.extraHostPermissions || []));
const adapterScripts = sites.map(site => site.adapterScript).filter(Boolean);
const manifest = JSON.parse(await fs.readFile(path.join(repoRoot, 'extension', 'manifest.json'), 'utf8'));

manifest.host_permissions = unique([...matches, ...extraHostPermissions]);
manifest.content_scripts = manifest.content_scripts.map(script => ({ ...script, matches }));
manifest.web_accessible_resources = manifest.web_accessible_resources.map(resource => ({
  ...resource,
  resources: unique([...resource.resources, ...adapterScripts]),
  matches
}));

await fs.mkdir(path.join(repoRoot, 'dist', 'extension'), { recursive: true });
await fs.writeFile(
  path.join(repoRoot, 'dist', 'extension', 'manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`
);

await fs.mkdir(path.join(repoRoot, 'dist', 'extension', 'sites'), { recursive: true });
await fs.writeFile(
  path.join(repoRoot, 'dist', 'extension', 'sites', 'registry.json'),
  `${JSON.stringify({ sites }, null, 2)}\n`
);

await copyFile(
  path.join(repoRoot, 'native-host', 'bin', 'ai-chrome-remote-host'),
  path.join(repoRoot, 'dist', 'native-host', 'bin', 'ai-chrome-remote-host'),
  0o755
);

console.log(`Generated extension manifest for ${sites.length} site(s) and copied native host wrapper.`);
