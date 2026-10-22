import { resolve, isSeeds, SEEDS } from './items.js';

const QTY = String.raw`(\d+)\s*(?:x\s*)?`;

class SpecError extends Error {}
export { SpecError };

const parseQuantity = (text) => {
  const match = text.match(new RegExp(`^${QTY}`));
  if (!match) return { quantity: 1, rest: text.trim() };
  return { quantity: Number(match[1]), rest: text.slice(match[0].length).trim() };
};

const resolveName = (phrase, index) => {
  const hit = resolve(phrase, index);
  if (!hit.exact) {
    const options = hit.candidates.map((c) => c.name);
    throw new SpecError(
      options.length
        ? `Ambiguous item "${phrase}". Cached candidates: ${options.join(', ')}. Confirm the exact name on MetaForge.`
        : `Unknown item "${phrase}". Search it on MetaForge, then: npm run items:add -- --name "<exact name>"`,
    );
  }
  return hit.exact;
};

/** One side of a "want" clause: "2 Kinetic Converter" | "300 seeds" | "offers". */
const parseWantPart = (part, index) => {
  const text = part.trim();
  if (/^(offers?|any offers?|open to offers?)$/i.test(text)) return { kind: 'offers' };
  const { quantity, rest } = parseQuantity(text);
  if (!rest) throw new SpecError(`Missing item name in "${part}"`);
  if (isSeeds(rest)) return { kind: 'seeds', amount: quantity };
  return { kind: 'item', name: resolveName(rest, index), quantity };
};

/**
 * Deterministic parse of one trade phrase. No model reasoning, no guessed names.
 * Shapes: "<qty> <item> for <qty> <item>[ each]", "buy <item> for <n> seeds", "<item> for offers".
 */
export const parseTrade = (phrase, { index, side: sideHint, defaultPerUnit = true } = {}) => {
  let text = String(phrase).trim().replace(/\s+/g, ' ');
  if (!text) throw new SpecError('Empty trade phrase');

  let side = sideHint ?? 'sell';
  const sideMatch = text.match(/^(sell|selling|buy|buying|wtb|wts)\b/i);
  if (sideMatch) {
    side = /^(buy|buying|wtb)/i.test(sideMatch[1]) ? 'buy' : 'sell';
    text = text.slice(sideMatch[0].length).trim();
  }

  let perUnit = defaultPerUnit;
  if (/\beach\b/i.test(text)) { perUnit = true; text = text.replace(/\beach\b/gi, '').trim(); }
  if (/\b(total|for the lot|in total)\b/i.test(text)) { perUnit = false; text = text.replace(/\b(total|for the lot|in total)\b/gi, '').trim(); }

  const split = text.split(/\s+for\s+/i);
  if (split.length < 2) throw new SpecError(`Could not find "for" in "${phrase}" (expected "<item> for <price>")`);
  const wantText = split.pop();
  const offerText = split.join(' for ');

  const { quantity, rest } = parseQuantity(offerText);
  const itemName = resolveName(rest, index);

  const parts = wantText.split(/\s*(?:\+|,|\band\b)\s*/i).filter(Boolean).map((part) => parseWantPart(part, index));
  if (parts.some((p) => p.kind === 'offers')) {
    if (parts.length > 1) throw new SpecError('"offers" cannot be combined with concrete prices');
    return makeSpec({ side, itemName, quantity, price: { kind: 'offers' }, perUnit: false });
  }
  const seeds = parts.filter((p) => p.kind === 'seeds');
  const items = parts.filter((p) => p.kind === 'item');
  if (seeds.length && items.length) throw new SpecError('MetaForge takes payment either in Seeds or in items, not both');
  const price = seeds.length
    ? { kind: 'seeds', amount: seeds.reduce((sum, p) => sum + p.amount, 0) }
    : { kind: 'items', items: items.map(({ name, quantity: q }) => ({ name, quantity: q })) };

  return makeSpec({ side, itemName, quantity, price, perUnit });
};

export const makeSpec = ({ side, itemName, quantity = 1, price, perUnit = true, note = '' }) => {
  if (!['sell', 'buy'].includes(side)) throw new SpecError(`side must be sell or buy, got ${side}`);
  if (!Number.isSafeInteger(quantity) || quantity <= 0) throw new SpecError('quantity must be a positive integer');
  validatePrice(price);
  return { side, item: { name: itemName, quantity }, price, perUnit, note };
};

const validatePrice = (price) => {
  if (!price || typeof price !== 'object') throw new SpecError('price is required');
  if (price.kind === 'seeds') {
    if (!Number.isSafeInteger(price.amount) || price.amount <= 0) throw new SpecError('seed amount must be a positive integer');
    return;
  }
  if (price.kind === 'items') {
    if (!price.items?.length) throw new SpecError('items price needs at least one item');
    for (const entry of price.items) {
      if (!entry.name) throw new SpecError('wanted item needs a name');
      if (!Number.isSafeInteger(entry.quantity) || entry.quantity <= 0) throw new SpecError(`wanted quantity for ${entry.name} must be a positive integer`);
    }
    return;
  }
  if (price.kind === 'offers') return;
  throw new SpecError(`unknown price kind ${price.kind}`);
};
export { validatePrice };

/**
 * What must actually be typed into the dialog. `perUnit` prices are multiplied
 * by the listing quantity here, once, in code — the historical source of wrong
 * quantities was repeated +/- clicking in the UI instead of this calculation.
 */
export const formTotals = (spec) => {
  const factor = spec.perUnit ? spec.item.quantity : 1;
  if (spec.price.kind === 'seeds') return { kind: 'seeds', amount: spec.price.amount * factor };
  if (spec.price.kind === 'items') {
    return { kind: 'items', items: spec.price.items.map((i) => ({ name: i.name, quantity: i.quantity * factor })) };
  }
  return { kind: 'offers' };
};

export const describe = (spec) => {
  const totals = formTotals(spec);
  const want = totals.kind === 'seeds' ? `${totals.amount} Seeds`
    : totals.kind === 'items' ? totals.items.map((i) => `${i.quantity}x ${i.name}`).join(' + ')
    : 'Offers';
  const unit = spec.price.kind === 'seeds' ? `${spec.price.amount} Seeds`
    : spec.price.kind === 'items' ? spec.price.items.map((i) => `${i.quantity}x ${i.name}`).join(' + ')
    : 'Offers';
  const per = spec.perUnit && spec.item.quantity > 1 ? ` [${unit} per unit]` : '';
  return `${spec.side.toUpperCase()} ${spec.item.quantity}x ${spec.item.name} -> ${want}${per}`;
};

/** Stable identity of a trade, used to refuse duplicate listings. */
export const fingerprint = (spec) => {
  const totals = formTotals(spec);
  const price = totals.kind === 'seeds' ? `seeds:${totals.amount}`
    : totals.kind === 'items' ? `items:${totals.items.map((i) => `${i.name}*${i.quantity}`).sort().join('|')}`
    : 'offers';
  return `${spec.side}:${spec.item.name}*${spec.item.quantity}:${price}`.toLowerCase();
};
