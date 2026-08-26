---
id: web-platform-styling
applies-to: ["**/*.css"]
stage: [code]
enforce: true
links: [.claude/engineering-rules.md]
---

The platform now covers what a styling dependency used to. Order the cascade explicitly with
`@layer reset, tokens, layout, components, utilities` — a declared layer order removes essentially
every legitimate reason for `!important`, so an `!important` in layered CSS is a specificity bug to
fix rather than a tool to use. Nesting is native; a preprocessor is not needed for it.

A component sizes itself from its container, not from the viewport: `container-type` plus
`@container` rather than a page-level media query, so the component stays correct when it moves into
a sidebar. Media queries remain right for what is genuinely a property of the device or the user —
`prefers-reduced-motion`, `prefers-color-scheme`, print.

Color lives in CSS custom properties, in `oklch()`, with derivations computed in CSS —
`color-mix()`, relative color syntax (`oklch(from var(--brand) …)`), and `light-dark()` for the two
schemes — not in a JS token file that needs a build step to become CSS. A custom property only
animates when declared with `@property`, so a typed `@property` declaration is required for any
custom property a transition targets.

Overlays use the platform: `popover` and `<dialog>` give top-layer stacking, light-dismiss, and
focus handling without a positioning or focus-trap dependency, and anchor positioning attaches them
to their trigger. Entry and exit animation is `@starting-style` with
`transition-behavior: allow-discrete`, not a `display` hack or a JS-timed class swap.

Runtime CSS-in-JS is not the default here: it costs work on every render and interacts badly with
server rendering. Prefer static CSS with custom properties for the dynamic part.
