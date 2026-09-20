# RecoveryPlane motion refinement

User explicitly asks to keep React, use established frontend libraries/assets (Motion.dev is an example), include a scroll effect, and avoid a generic generated appearance. Preserve all working recovery behavior. Prior frontend work is complete; this is a focused refinement, not a rebuild.

Scope: apps/web/src only, docs/motion-report.md. Root installs the `motion` dependency and owns package/lockfiles, backend, docs and release checks. Do not spawn agents.

Implement with official `motion/react` APIs, using MotionConfig reducedMotion="user" and useReducedMotion for custom scroll-linked motion. References: https://motion.dev/docs/react-scroll-animations, https://motion.dev/docs/react-accessibility. No premium examples, third-party screenshots or unlicensed asset copying. Lucide icons already provide vector assets. No raster generation.

Design: restrained ink/ivory/teal operations product. Add a React recovery-flow visual to the launch/story area (report → controlled action → origin confirmation) and a meaningful scroll-linked walkthrough in Demo Lab. The latter should show the distinction between patch success and confirmed recovery with a sticky vertical progress/flow on desktop and a clear stacked presentation on mobile. Native scrolling only; no scroll hijacking. This is explicitly illustrative educational content, not simulated live operational metrics. User can still reach/run every real scenario.

Add modest route entrance and modal entrance transitions. Avoid replaying on each query refetch, animating table values/rows every polling cycle, moving focused controls, or delaying form operations. Scroll effect should be obvious when deliberately scrolling the walkthrough, calm elsewhere. Important text remains accessible and readable without animation; reduced motion removes transforms/parallax. Modal focus handling and form state must keep working. Use an accessible heading structure and helpful concrete copy, no decorative filler.

Check responsive layout, prevent horizontal overflow, preserve semantic buttons and reduce existing too-small mobile helper text if touched. Use focused components e.g. motion.tsx/recovery-story.tsx, not sprawling new JSX strings. Existing frontend files are compressed; format files you substantially touch with Prettier for reviewability. Run `pnpm.cmd --filter @recoveryplane/web build` (sandbox escalation may be needed for pnpm). Report exact changes and verification in docs/motion-report.md. Parent will inspect in browser and review.
