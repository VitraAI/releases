#!/usr/bin/env node
// Validates release files against schema/release.schema.json plus the rules a
// schema can't express (file name = id, date matches id, known areas, unique
// section ids, highlights that exist, parseable inline Markdown) and the
// brevity limits of the house style (LIMITS).
//
//   node scripts/validate.mjs                 every file in releases/
//   node scripts/validate.mjs 26.10.13 ...  just these ids
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

import { parseInline } from './lib/inline.mjs';
import {
  ROOT,
  idForDate,
  listReleaseFiles,
  loadAreas,
  readJson,
  releasePath,
} from './lib/release.mjs';

const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
addFormats(ajv);
const schemaCheck = ajv.compile(readJson(join(ROOT, 'schema', 'release.schema.json')));
const areas = loadAreas();

/** Returns a list of problems; empty means valid. */
export function validateRelease(release, fileName) {
  if (!schemaCheck(release)) {
    return schemaCheck.errors.map((e) => `${e.instancePath || '/'} ${e.message}`);
  }
  const errors = [];

  if (fileName && fileName !== `${release.id}.json`) {
    errors.push(`file name must be ${release.id}.json`);
  }
  if (release.id.slice(0, 8) !== idForDate(release.date)) {
    errors.push(`date ${release.date} does not match id ${release.id}`);
  }

  const ids = new Set();
  release.sections.forEach((section, i) => {
    const at = `/sections/${i} (${section.id})`;
    if (ids.has(section.id)) errors.push(`${at}: duplicate section id`);
    ids.add(section.id);
    if (!areas.byId.has(section.area)) {
      errors.push(`${at}: unknown area "${section.area}" — add it to config/areas.json`);
    }
    if (section.area === 'fixes' && section.kind !== 'fixed') {
      errors.push(`${at}: a fixes section must have kind "fixed"`);
    }
  });
  for (const h of release.highlights ?? []) {
    if (!ids.has(h)) errors.push(`/highlights: no section "${h}"`);
  }

  const texts = [];
  release.sections.forEach((s, i) => {
    if (s.note) texts.push([`/sections/${i}/note`, s.note]);
    s.items.forEach((item, j) => {
      const at = `/sections/${i}/items/${j}`;
      if (item.title) texts.push([`${at}/title`, item.title]);
      if (item.body) texts.push([`${at}/body`, item.body]);
      item.children?.forEach((c, k) => {
        if (c.title) texts.push([`${at}/children/${k}/title`, c.title]);
        if (c.body) texts.push([`${at}/children/${k}/body`, c.body]);
      });
    });
  });
  for (const [at, text] of texts) {
    try {
      parseInline(text);
    } catch (e) {
      errors.push(`${at}: ${e.message}`);
    }
  }

  return [...errors, ...styleErrors(release)];
}

/**
 * The house style: short, headline-only notes. Up to
 * three feature sections with a one-sentence pitch, then "More updates" and
 * "Fixes", every item one line.
 */
export const LIMITS = {
  summaryChars: 160,
  featureSections: 3,
  itemsPerSection: 5,
  itemWords: 15,
  noteWords: 25,
  releaseWords: 220,
};

const words = (s) => (s ? s.trim().split(/\s+/).length : 0);

function styleErrors(release) {
  const errors = [];
  if (release.summary.length > LIMITS.summaryChars) {
    errors.push(
      `/summary: ${release.summary.length} characters, keep it to ${LIMITS.summaryChars}`,
    );
  }
  const features = release.sections.filter((s) => !['improvements', 'fixes'].includes(s.area));
  if (features.length > LIMITS.featureSections) {
    errors.push(
      `${features.length} feature sections, keep ${LIMITS.featureSections} and move the rest to "More updates"`,
    );
  }
  let total = 0;
  release.sections.forEach((s, i) => {
    const at = `/sections/${i} (${s.id})`;
    total += words(s.note);
    if (words(s.note) > LIMITS.noteWords) {
      errors.push(`${at}/note: ${words(s.note)} words, keep it to ${LIMITS.noteWords}`);
    }
    if (s.items.length > LIMITS.itemsPerSection) {
      errors.push(
        `${at}: ${s.items.length} items, keep the ${LIMITS.itemsPerSection} that matter most`,
      );
    }
    s.items.forEach((item, j) => {
      const n = words(item.title) + words(item.body);
      total += n;
      if (n > LIMITS.itemWords) {
        errors.push(`${at}/items/${j}: ${n} words, keep it to one line of ${LIMITS.itemWords}`);
      }
      if (item.children)
        errors.push(`${at}/items/${j}: no sub-lists, make each point its own item`);
    });
  });
  if (total > LIMITS.releaseWords) {
    errors.push(`${total} words in sections, keep the release to ${LIMITS.releaseWords}`);
  }
  return errors;
}

function main(args) {
  const files = args.length ? args.map(releasePath) : listReleaseFiles();
  let failed = 0;
  for (const file of files) {
    let release;
    try {
      release = readJson(file);
    } catch (e) {
      console.error(`✗ ${basename(file)}: ${e.message}`);
      failed++;
      continue;
    }
    const errors = validateRelease(release, basename(file));
    if (errors.length) {
      failed++;
      console.error(`✗ ${basename(file)}`);
      for (const e of errors) console.error(`    ${e}`);
    } else {
      console.log(`✓ ${basename(file)}`);
    }
  }
  if (failed) {
    console.error(`\n${failed} of ${files.length} release file(s) invalid.`);
    process.exit(1);
  }
  console.log(`\n${files.length} release file(s) valid.`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
