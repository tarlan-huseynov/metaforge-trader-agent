import { readJson, writeJson } from './json.js';
import { itemsPath } from './paths.js';

/** Shorthand the operator types, expanded before matching. Never used to invent names. */
export const SHORTHAND = {
  bp: 'blueprint',
  bps: 'blueprints',
  kinetic: 'kinetic converter',
  kinetics: 'kinetic converter',
  kc: 'kinetic converter',
  seed: 'seeds',
  'assorted seed': 'seeds',
  'assorted seeds': 'seeds',
};

const normalize = (text) =>
  String(text)
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Words that carry no identity: counts and filler the operator types around a name. */
const FILLER = new Set(['assorted', 'x', 'pcs', 'pc', 'each', 'the', 'a', 'an']);

const expand = (text) => {
  let phrase = normalize(text);
  // Phrase-level shorthand first (longest key wins), then per-word.
  for (const key of Object.keys(SHORTHAND).sort((a, b) => b.length - a.length)) {
    if (!key.includes(' ')) continue;
    phrase = phrase.replaceAll(normalize(key), normalize(SHORTHAND[key]));
  }
  const out = [];
  for (const word of phrase.split(' ').filter(Boolean)) {
    if (FILLER.has(word) || /^\d+$/.test(word)) continue;
    const mapped = SHORTHAND[word];
    out.push(...(mapped ? normalize(mapped).split(' ') : [word]));
  }
  return out;
};

const singular = (word) => (word.length > 3 && word.endsWith('s') ? word.slice(0, -1) : word);
const stem = (words) => words.map(singular);

export const loadItems = () => readJson(itemsPath, { _meta: {}, items: [] });

export const buildIndex = (data = loadItems()) => {
  const entries = data.items.map((item) => {
    const words = stem(expand(item.name));
    return { ...item, key: words.join(' '), words: new Set(words) };
  });
  const exact = new Map(entries.map((entry) => [entry.key, entry]));
  return { data, entries, exact };
};

/**
 * Resolve a typed phrase to cached canonical item names.
 * Returns ranked candidates; `exact` is set only when there is one unambiguous winner.
 */
export const resolve = (query, index = buildIndex()) => {
  const words = stem(expand(query));
  const key = words.join(' ');
  if (!key) return { query, exact: null, candidates: [] };

  const direct = index.exact.get(key);
  if (direct) return { query, exact: direct.name, candidates: [{ name: direct.name, score: 1, category: direct.category }] };

  const scored = [];
  for (const entry of index.entries) {
    const hits = words.filter((word) => entry.words.has(word)).length;
    if (!hits) continue;
    // Reward covering the query, penalise extra words in the candidate name.
    const coverage = hits / words.length;
    const precision = hits / entry.words.size;
    const score = Number((coverage * 0.7 + precision * 0.3).toFixed(4));
    if (coverage === 1 || score >= 0.5) scored.push({ name: entry.name, score, category: entry.category });
  }
  scored.sort((a, b) => b.score - a.score || a.name.length - b.name.length);

  const top = scored[0];
  // A thin margin over the runner-up is treated as ambiguous: a wrong item is worse than a question.
  const unambiguous = top && (!scored[1] || top.score - scored[1].score >= 0.1);
  return { query, exact: unambiguous && top.score >= 0.75 ? top.name : null, candidates: scored.slice(0, 8) };
};

export const isCached = (name, index = buildIndex()) =>
  index.exact.has(stem(expand(name)).join(' '));

/** Only ever called with a name observed verbatim in MetaForge's own autocomplete. */
export const cacheItem = (name, category = '') => {
  const data = loadItems();
  const exists = data.items.find((item) => item.name.toLowerCase() === name.toLowerCase());
  if (exists) return { added: false, name: exists.name };
  const today = new Date().toISOString().slice(0, 10);
  data.items.push({ name, category, seenAt: today });
  data.items.sort((a, b) => a.name.localeCompare(b.name));
  data._meta = { ...data._meta, updatedAt: today };
  writeJson(itemsPath, data);
  return { added: true, name };
};

export const filterItems = ({ category, nameMatch } = {}, index = buildIndex()) => {
  const needle = nameMatch ? stem(expand(nameMatch)) : null;
  return index.entries
    .filter((entry) => (!category || entry.category === category) && (!needle || needle.every((word) => entry.words.has(word))))
    .map((entry) => ({ name: entry.name, category: entry.category }));
};

export const SEEDS = 'Seeds';
export const isSeeds = (name) => stem(expand(name)).join(' ') === 'seed';
