import type { ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";

// Opacity-only entrances keep focused controls stationary and forms immediately usable.
export function RouteEntrance({ children }: { children: ReactNode }) {
  const reducedMotion = useReducedMotion();
  return (
    <motion.div
      initial={{ opacity: reducedMotion ? 1 : 0.55 }}
      animate={{ opacity: 1 }}
      transition={{ duration: reducedMotion ? 0 : 0.22 }}
    >
      {children}
    </motion.div>
  );
}
