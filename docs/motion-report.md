# RecoveryPlane motion refinement

Implemented the bounded design in `docs/motion-brief.md` using the installed `motion/react` package and existing Lucide icons. No backend, API, package manifest, or lockfile changes were made by this frontend subtask.

## Changes

- Added `RecoveryFlow` to the launch story: report, controlled action, and origin confirmation, with explanatory copy that distinguishes command success from resolution.
- Replaced Demo Lab's small walkthrough strip with three readable chapters: missing vendor country, successful patch with an open case, and verification confirmed by the origin.
- Added a desktop sticky flow diagram whose teal progress line follows the walkthrough's native scroll position. Stage emphasis changes as the reader advances. The diagram is decorative and hidden from assistive technology; the semantic ordered chapters carry the complete explanation.
- At 800px and below, the story becomes a stacked vertical reading sequence without a sticky diagram. Existing real scenario controls and live vendor state remain available.
- Added opacity-only route entrances (220ms) keyed to the route, and modal entrances (160ms). No exit delay, transformed form control, or polling-triggered animation was added. Existing modal focus trapping, Escape handling, scroll lock, and focus restoration remain intact.
- Set global `MotionConfig reducedMotion="user"` and explicit `useReducedMotion` guards. Reduced motion makes route and modal entrances immediate and keeps the scroll-progress line static; chapter text is always visible.
- Added focused `motion.tsx`, `recovery-story.tsx`, and `recovery-story.css` files. Formatted substantially edited `App.tsx`, `pages.tsx`, and `ui.tsx` with Prettier. Increased touched mobile helper and walkthrough text to readable sizes.
- Updated the shared title-case helper to separate camelCase context labels (`vendorName` becomes `Vendor Name`).

## Verification

- `pnpm.cmd --filter @recoveryplane/web build`: passed (TypeScript and Vite production build).
- Prettier applied to all six edited/added frontend files.
- The first sandboxed pnpm invocation failed before execution because pnpm could not resolve the user directory (`EPERM`). The same commands passed with the approved sandbox escalation.
- No additional unit tests were added for the reversible presentation change. Parent task owns the full application tests and browser verification of desktop, mobile, reduced motion, modal keyboard behavior, and working recovery scenarios.

## References

- [Motion scroll-linked animation API](https://motion.dev/docs/react-scroll-animations)
- [Motion accessibility and reduced motion](https://motion.dev/docs/react-accessibility)

Only official public APIs were used; no premium example, third-party screenshot, or raster asset was copied.
