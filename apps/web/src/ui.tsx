import { useEffect, useRef, type ReactNode } from "react";
import {
  Activity,
  Inbox,
  Layers3,
  Loader2,
  TriangleAlert,
  X,
} from "lucide-react";
import type { Audit } from "./api";
import { motion, useReducedMotion } from "motion/react";
export const titleCase = (value: string) =>
  value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
export function age(value: string) {
  const minutes = Math.max(
    0,
    Math.floor((Date.now() - new Date(value).getTime()) / 60000),
  );
  return minutes < 1
    ? "Just now"
    : minutes < 60
      ? `${minutes}m ago`
      : minutes < 1440
        ? `${Math.floor(minutes / 60)}h ago`
        : `${Math.floor(minutes / 1440)}d ago`;
}
export function go(path: string) {
  window.location.hash = path;
}
export function Badge({ value }: { value: string }) {
  return (
    <span className={`badge badge-${value.toLowerCase()}`}>
      {titleCase(value)}
    </span>
  );
}
export function Busy() {
  return (
    <span className="loading">
      <Loader2 size={17} className="spin" /> Loading workspace data…
    </span>
  );
}
export function ErrorBox({
  error,
  retry,
}: {
  error: unknown;
  retry?: () => void;
}) {
  return (
    <div className="notice error" role="alert">
      <TriangleAlert size={18} />
      <span>{error instanceof Error ? error.message : String(error)}</span>
      {retry && (
        <button className="text-button" onClick={retry}>
          Try again
        </button>
      )}
    </div>
  );
}
export function Empty({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="empty">
      <Inbox size={29} />
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const reducedMotion = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const priorOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.focus();
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeRef.current();
      if (event.key === "Tab") {
        const focusables = ref.current?.querySelectorAll<HTMLElement>(
          "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]",
        );
        if (!focusables?.length) {
          event.preventDefault();
          return;
        }
        const first = focusables[0]!;
        const last = focusables[focusables.length - 1]!;
        if (
          event.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === ref.current)
        ) {
          event.preventDefault();
          last.focus();
        } else if (
          !event.shiftKey &&
          (document.activeElement === last ||
            document.activeElement === ref.current)
        ) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => {
      document.removeEventListener("keydown", handler);
      document.body.style.overflow = priorOverflow;
      previous?.focus();
    };
  }, []);
  return (
    <motion.div
      className="modal-backdrop"
      initial={{ opacity: reducedMotion ? 1 : 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: reducedMotion ? 0 : 0.16 }}
    >
      <div
        className="modal"
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-heading">
          <h2>{title}</h2>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label="Close dialog"
          >
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </motion.div>
  );
}
export function Logo() {
  return (
    <div className="brand">
      <span className="brand-icon">
        <Layers3 size={22} strokeWidth={1.8} />
      </span>
      <span>
        RecoveryPlane<span className="brand-dot">.</span>
      </span>
    </div>
  );
}
export function Timeline({ events }: { events: Audit[] }) {
  return (
    <div className="timeline">
      {events.length ? (
        events.map((event) => (
          <div className="timeline-event" key={event.id}>
            <span className="timeline-dot">
              <Activity size={13} />
            </span>
            <div>
              <strong>{event.message}</strong>
              <small>
                {event.actorName} <span>·</span> {titleCase(event.eventType)}{" "}
                <span>·</span>{" "}
                <time title={new Date(event.createdAt).toLocaleString()}>
                  {age(event.createdAt)}
                </time>
              </small>
            </div>
          </div>
        ))
      ) : (
        <p className="muted">No activity has been recorded yet.</p>
      )}
    </div>
  );
}
