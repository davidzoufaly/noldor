// Reference `geometryCommand` producer for the noldor `geometry-compare` lane.
//
// Usage:
//   NOLDOR_GEOMETRY_SURFACE=<surface> node scripts/geometry-capture.mjs <url> <out.json> <width> <height>
//
// The lane sets NOLDOR_GEOMETRY_SURFACE to the uiBoot key under review; set it
// yourself when running by hand. Validate the output with
// `pnpm noldor design geometry-validate <out.json> --side impl --surface <name>`.
//
// This file is SCAFFOLDED, not synced: it is yours to edit. Add the waits, the
// login step, or the fixture seeding your app needs — `noldor init --update`
// never overwrites it and `checks template-sync` never compares it.
//
// It needs playwright in YOUR package.json (`pnpm add -D playwright`); the
// framework ships no browser dependency. Playwright is imported only after the
// inputs are checked, so a usage error prints even where it is not installed.

import { writeFile } from 'node:fs/promises';

const USAGE =
  'usage: NOLDOR_GEOMETRY_SURFACE=<surface> node scripts/geometry-capture.mjs <url> <out.json> <width> <height>';

/** Input errors exit 2, the same code the noldor CLIs use for usage errors. */
function usageError(why) {
  process.stderr.write(`geometry-capture: ${why}\n${USAGE}\n`);
  process.exit(2);
}

const [url, out, widthArg, heightArg] = process.argv.slice(2);
if (!url || !out || !widthArg || !heightArg) usageError('expected four arguments');

// Playwright viewports are whole pixels. The lane's {width}/{height} come from
// the design document and may be fractional; rounding stays inside the lane's
// 1px viewport agreement.
const width = Math.round(Number(widthArg));
const height = Math.round(Number(heightArg));
if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
  usageError(`width and height must be positive numbers, got '${widthArg}' x '${heightArg}'`);
}

// Required, never defaulted: the document's `surface` must equal the surface
// under review, and a guessed name would fail that check on every surface but one.
const surface = process.env.NOLDOR_GEOMETRY_SURFACE;
if (!surface) usageError('NOLDOR_GEOMETRY_SURFACE is not set');

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch (err) {
  process.stderr.write(
    `geometry-capture: cannot load playwright (${err instanceof Error ? err.message : String(err)}) — add it: pnpm add -D playwright\n`,
  );
  process.exit(1);
}

// The element the route renders into. Change this to your app's root if it is
// not `body` — every box is reported relative to it.
const CAPTURE_ROOT = 'body';

const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width, height },
    // Device pixel ratio 1 is part of the document contract: the design side
    // reports CSS pixels, so a 2x capture would double every value.
    deviceScaleFactor: 1,
  });
  await page.goto(url, { waitUntil: 'networkidle' });
  // ADD YOUR WAITS HERE — e.g. await page.getByRole('table').waitFor();

  const nodes = await page.evaluate((rootSelector) => {
    const root = document.querySelector(rootSelector);
    if (root === null) throw new Error(`capture root '${rootSelector}' matched nothing`);
    const origin = root.getBoundingClientRect();
    const num = (v) => {
      const n = Number.parseFloat(v);
      return Number.isFinite(n) ? n : 0;
    };
    const found = [];
    const walk = (el) => {
      const style = window.getComputedStyle(el);
      // Excluded per the document contract: invisible and
      // hidden-from-assistive-tech subtrees are not layout.
      if (style.visibility === 'hidden' || el.getAttribute('aria-hidden') === 'true') return;
      if (style.display === 'contents') {
        for (const child of el.children) walk(child);
        return;
      }
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        // Both rects are viewport-relative, so the scroll offset cancels and
        // the difference puts the capture root at {0,0}.
        const box = { x: r.left - origin.left, y: r.top - origin.top, w: r.width, h: r.height };
        const hasText = [...el.childNodes].some(
          (n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim() !== '',
        );
        const fontSize = num(style.fontSize);
        // The document requires a positive fontSize and non-empty text on
        // every text node; an element failing either is not text-bearing.
        const text = (el.textContent ?? '').trim().slice(0, 120);
        const isText = hasText && fontSize > 0 && text !== '';
        const spacing = {
          padding: [
            num(style.paddingTop),
            num(style.paddingRight),
            num(style.paddingBottom),
            num(style.paddingLeft),
          ],
          margin: [
            num(style.marginTop),
            num(style.marginRight),
            num(style.marginBottom),
            num(style.marginLeft),
          ],
        };
        if (style.rowGap !== 'normal' && num(style.rowGap) !== 0)
          spacing.rowGap = num(style.rowGap);
        if (style.columnGap !== 'normal' && num(style.columnGap) !== 0) {
          spacing.columnGap = num(style.columnGap);
        }
        const node = {
          name: el.id !== '' ? el.id : el.tagName.toLowerCase(),
          kind: isText ? 'text' : el.children.length > 0 ? 'container' : 'shape',
          box,
          spacing,
        };
        if (isText) {
          node.fontSize = fontSize;
          node.text = text;
        }
        found.push(node);
      }
      // An SVG root is layout; its internal geometry is paint.
      if (el.tagName.toLowerCase() === 'svg') return;
      for (const child of el.children) walk(child);
    };
    for (const child of root.children) walk(child);
    return found;
  }, CAPTURE_ROOT);

  // The viewport reported is the one set above, not the capture root's box:
  // <body> is shorter than the design page on any non-full-height route, and
  // the lane compares viewports before anything else.
  const doc = { surface, viewport: { width, height }, nodes };
  await writeFile(out, JSON.stringify(doc, null, 1), 'utf8');
} finally {
  await browser.close();
}
