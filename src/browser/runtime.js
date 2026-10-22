/*
 * MetaForge page-side runtime.
 *
 * Injected once per page load (src/lib/driver.js -> `npm run payload:install`).
 * After that each job is a one-line payload, and the result is collected by
 * reading window.__MF_JOB. A whole batch of listings therefore costs three
 * browser calls instead of ~15 per listing.
 *
 * Rules this file exists to enforce:
 *  - quantities are written once with the native value setter, never by clicking
 *    +/- (repeated clicks double-registered and produced 12 where 2 was meant);
 *  - every field is read back after writing and compared against the spec;
 *  - any mismatch aborts the job before anything is submitted.
 *
 * It drives the operator's own visible UI only: no private endpoints, no tokens,
 * no cookies, no storage reads.
 */
(() => {
  const SEL = {
    dialog: '[role="dialog"]',
    option: '[role="option"]',
    quantity: '#listing-quantity',
    price: '#listing-price',
    note: '#listing-note',
    addAnother: 'input[placeholder*="another item" i]',
    search: 'input[placeholder*="Search for an item" i]',
  };
  const MY_LISTINGS = '/market/my-listings';

  const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
  const text = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
  // getClientRects, not offsetParent: the listing dialog is position:fixed, which
  // leaves offsetParent null even while the dialog is fully on screen.
  const visible = (el) => !!el && el.getClientRects().length > 0 && !el.disabled && el.getAttribute('aria-hidden') !== 'true';

  class Abort extends Error {
    constructor(message, detail) { super(message); this.detail = detail; }
  }

  const nativeSet = (el, value) => {
    const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value');
    desc.set.call(el, String(value));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };

  const waitFor = async (probe, { timeout = 8000, interval = 60, what = 'condition' } = {}) => {
    const deadline = Date.now() + timeout;
    for (;;) {
      const value = probe();
      if (value) return value;
      if (Date.now() > deadline) throw new Abort(`Timed out waiting for ${what}`);
      await sleep(interval);
    }
  };

  const dialog = () => {
    const open = [...document.querySelectorAll(SEL.dialog)].filter(visible);
    return open[open.length - 1] || null;
  };

  const buttons = (scope) => [...(scope || dialog() || document).querySelectorAll('button')].filter(visible);
  const buttonByText = (pattern, scope) => buttons(scope).find((b) => pattern.test(text(b)) || pattern.test(b.getAttribute('aria-label') || ''));

  const clickButton = async (pattern, { what = String(pattern), scope } = {}) => {
    const button = await waitFor(() => buttonByText(pattern, scope), { what: `button ${what}` });
    button.click();
    await sleep(120);
    return button;
  };

  /** Dialog text inputs that are not a quantity or the seed price: the item search boxes. */
  const searchInputs = () => {
    const root = dialog();
    if (!root) return [];
    return [...root.querySelectorAll('input')].filter((input) => {
      if (!visible(input)) return false;
      if (input.id === 'listing-quantity' || input.id === 'listing-price') return false;
      return !/quantity$/i.test(input.getAttribute('aria-label') || '');
    });
  };

  /** Type a name, wait for MetaForge's own autocomplete, click the matching option. */
  const pickItem = async (input, name) => {
    nativeSet(input, '');
    await sleep(50);
    nativeSet(input, name);
    input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'a' }));
    const wanted = name.toLowerCase();
    const option = await waitFor(
      () => [...document.querySelectorAll(SEL.option)].filter(visible)
        .find((o) => text(o).toLowerCase() === wanted || text(o).toLowerCase().startsWith(`${wanted} `)),
      { what: `autocomplete option "${name}"`, timeout: 9000 },
    );
    const label = text(option);
    option.click();
    await sleep(200);
    return label;
  };

  const quantityInputFor = (name) => {
    const root = dialog();
    if (!root) return null;
    const wanted = `${name} quantity`.toLowerCase();
    return [...root.querySelectorAll('input')].find((i) => (i.getAttribute('aria-label') || '').toLowerCase() === wanted);
  };

  /** Write a quantity once, then prove it took. */
  const setQuantity = (input, value, label) => {
    if (!input) throw new Abort(`No quantity input for ${label}`);
    nativeSet(input, value);
    input.blur();
    if (String(input.value).trim() !== String(value)) {
      throw new Abort(`Quantity for ${label} read back as "${input.value}", expected "${value}"`);
    }
  };

  const readForm = () => {
    const root = dialog();
    if (!root) return null;
    const quantity = root.querySelector(SEL.quantity);
    const price = root.querySelector(SEL.price);
    const note = root.querySelector(SEL.note);
    const wanted = [...root.querySelectorAll('input')]
      .map((input) => {
        const match = (input.getAttribute('aria-label') || '').match(/^(.*) quantity$/i);
        return match && match[1].toLowerCase() !== 'quantity' ? { name: match[1], quantity: Number(input.value) } : null;
      })
      .filter(Boolean);
    return {
      quantity: quantity ? Number(quantity.value) : null,
      seeds: price ? Number(price.value) : null,
      wanted,
      note: note ? note.value : null,
      bodyText: text(root).slice(0, 500),
    };
  };

  const closeDialog = async () => {
    if (!dialog()) return;
    const cancel = buttonByText(/^(cancel)$/i);
    if (cancel) cancel.click();
    await sleep(300);
    if (dialog()) {
      document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }));
      await sleep(250);
    }
  };

  /** Compare the live form against the spec. Returns [] when the form is exactly right. */
  const verify = (spec) => {
    const form = readForm();
    const problems = [];
    if (!form) return ['dialog closed before verification'];
    if (form.quantity !== spec.item.quantity) problems.push(`quantity ${form.quantity} != ${spec.item.quantity}`);
    if (!form.bodyText.toLowerCase().includes(spec.item.name.toLowerCase())) problems.push(`item "${spec.item.name}" not shown in dialog`);
    if (spec.form.kind === 'seeds' && form.seeds !== spec.form.amount) problems.push(`seeds ${form.seeds} != ${spec.form.amount}`);
    if (spec.form.kind === 'items') {
      for (const entry of spec.form.items) {
        const row = form.wanted.find((w) => w.name.toLowerCase() === entry.name.toLowerCase());
        if (!row) problems.push(`wanted item ${entry.name} missing`);
        else if (row.quantity !== entry.quantity) problems.push(`${entry.name} quantity ${row.quantity} != ${entry.quantity}`);
      }
      const extra = form.wanted.filter((w) => !spec.form.items.some((i) => i.name.toLowerCase() === w.name.toLowerCase()));
      if (extra.length) problems.push(`unexpected wanted items: ${extra.map((e) => e.name).join(', ')}`);
    }
    const note = spec.note || '';
    if (note && form.note !== note) problems.push(`note "${form.note}" != "${note}"`);
    if (!note && form.note) problems.push(`unexpected note "${form.note}"`);
    return problems;
  };

  /** The note field only exists after the dialog's "+ Add a note" toggle is clicked. */
  const setNote = async (note) => {
    let field = dialog().querySelector(SEL.note);
    if (!field && note) {
      const toggle = buttonByText(/add a note/i);
      if (!toggle) throw new Abort('No note field and no "Add a note" toggle in the dialog');
      toggle.click();
      field = await waitFor(() => dialog().querySelector(SEL.note), { what: 'note field' });
    }
    if (!field) return;
    nativeSet(field, note);
    field.blur();
  };

  /**
   * "New listing" is a three-screen wizard: what do you want to do -> what do you
   * want in return -> the form. The edit dialog shows the form directly, so each
   * wizard button is clicked only when it is actually present.
   */
  const fillListing = async (spec) => {
    const sideButton = spec.side === 'buy' ? /^Buy an item\b/i : /^Sell an item\b/i;
    if (buttonByText(sideButton)) await clickButton(sideButton, { what: `${spec.side} side` });

    const modeButton = spec.form.kind === 'seeds' ? /^Seeds\b/ : spec.form.kind === 'items' ? /^Items\b/ : /^Offers\b/;
    if (buttonByText(modeButton)) await clickButton(modeButton, { what: `payment mode ${spec.form.kind}` });

    const search = await waitFor(() => dialog().querySelector(SEL.search) || searchInputs()[0], { what: 'item search field' });
    const picked = await pickItem(search, spec.item.name);
    const wanted = spec.item.name.toLowerCase();
    if (picked.toLowerCase() !== wanted && !picked.toLowerCase().startsWith(`${wanted} `)) {
      throw new Abort(`Autocomplete returned "${picked}" for "${spec.item.name}"`);
    }

    const quantity = await waitFor(() => dialog().querySelector(SEL.quantity), { what: 'quantity field' });
    setQuantity(quantity, spec.item.quantity, 'listing quantity');

    if (spec.form.kind === 'seeds') {
      const price = await waitFor(() => dialog().querySelector(SEL.price), { what: 'seed price field' });
      nativeSet(price, spec.form.amount);
      price.blur();
      if (Number(price.value) !== spec.form.amount) throw new Abort(`Seed price read back as "${price.value}", expected ${spec.form.amount}`);
    }

    if (spec.form.kind === 'items') {
      for (const entry of spec.form.items) {
        if (!quantityInputFor(entry.name)) {
          const input = await waitFor(
            () => dialog().querySelector(SEL.addAnother) || searchInputs().find((i) => !i.value),
            { what: `"add another item" field for ${entry.name}` },
          );
          await pickItem(input, entry.name);
          await waitFor(() => quantityInputFor(entry.name), { what: `${entry.name} quantity row` });
        }
        setQuantity(quantityInputFor(entry.name), entry.quantity, entry.name);
      }
      // An edit dialog can already carry items the spec does not ask for.
      const extra = readForm().wanted.filter((row) => !spec.form.items.some((i) => i.name.toLowerCase() === row.name.toLowerCase()));
      for (const row of extra) {
        const remove = buttonByText(new RegExp(`^Remove ${row.name}$`, 'i'));
        if (remove) { remove.click(); await sleep(150); }
      }
    }

    await setNote(spec.note || '');
    return verify(spec);
  };

  const rowsSnapshot = () =>
    [...document.querySelectorAll('main [class*="listing"], main li, main tr')]
      .map((el) => text(el))
      .filter((t) => t.length > 8);

  const createOne = async (spec, commit) => {
    await closeDialog();
    await clickButton(/^New listing$/i, { what: 'New listing', scope: document });
    await waitFor(() => dialog(), { what: 'listing dialog' });
    const problems = await fillListing(spec);
    const form = readForm();
    if (problems.length) {
      await closeDialog();
      return { id: spec.id, ok: false, stage: 'verify', problems, form };
    }
    if (!commit) {
      await closeDialog();
      return { id: spec.id, ok: true, dryRun: true, form };
    }
    const before = rowsSnapshot().length;
    await clickButton(/^(create listing|save changes)$/i, { what: 'submit' });
    await waitFor(() => !dialog(), { what: 'dialog to close after submit', timeout: 12000 });
    await sleep(700);
    const after = rowsSnapshot();
    const evidence = after.filter((row) => row.toLowerCase().includes(spec.item.name.toLowerCase()));
    return {
      id: spec.id,
      ok: evidence.length > 0,
      dryRun: false,
      form,
      rowsBefore: before,
      rowsAfter: after.length,
      evidence: evidence.slice(0, 3),
    };
  };

  /** Live stash read. Names live only in each slot's aria-label. */
  const readInventory = () => {
    const slots = [...document.querySelectorAll('.inventory-stash__slot-grid > div.inventory-slot')];
    const items = [];
    for (const slot of slots) {
      const label = slot.getAttribute('aria-label') || '';
      if (!label || /^empty inventory slot$/i.test(label)) continue;
      const match = label.match(/^(.*?)(?:, stack of (\d+))?$/i);
      items.push({ name: match[1].trim(), quantity: match[2] ? Number(match[2]) : 1 });
    }
    const merged = new Map();
    for (const item of items) merged.set(item.name, (merged.get(item.name) || 0) + item.quantity);
    return {
      readAt: new Date().toISOString(),
      slots: slots.length,
      items: [...merged].map(([name, quantity]) => ({ name, quantity })).sort((a, b) => a.name.localeCompare(b.name)),
    };
  };

  const run = (job) => {
    const state = { done: false, startedAt: new Date().toISOString(), job: job.kind, results: [], error: null };
    window.__MF_JOB = state;
    (async () => {
      try {
        if (job.kind === 'create' && !location.pathname.includes(MY_LISTINGS)) {
          throw new Abort(`Wrong page: ${location.pathname} (expected ${MY_LISTINGS})`);
        }
        if (job.kind === 'create') {
          for (const spec of job.specs) {
            const result = await createOne(spec, job.commit);
            state.results.push(result);
            if (!result.ok && job.stopOnError !== false) break;
            await sleep(job.pauseMs ?? 400);
          }
        } else if (job.kind === 'inventory') state.results.push(readInventory());
        else if (job.kind === 'readForm') state.results.push(readForm());
        else throw new Abort(`Unknown job kind ${job.kind}`);
      } catch (error) {
        state.error = { message: error.message, detail: error.detail ?? null };
        try { await closeDialog(); } catch (ignored) { /* dialog already gone */ }
      } finally {
        state.finishedAt = new Date().toISOString();
        state.done = true;
      }
    })();
    return JSON.stringify({ started: true, kind: job.kind, count: job.specs?.length ?? 1 });
  };

  // Primitives are exported so a later fix can be injected as a small patch
  // instead of re-sending this whole file through the conversation.
  window.MF = {
    run, readForm, readInventory, verify, closeDialog, setNote,
    helpers: { sleep, text, visible, nativeSet, waitFor, dialog, buttons, buttonByText, clickButton, searchInputs, pickItem, quantityInputFor, setQuantity, rowsSnapshot, Abort },
  };
  return JSON.stringify({ installed: true, href: location.href });
})()
