import { useRef, useState } from "react";
import {
  ArrowDown,
  Check,
  CheckCheck,
  FileWarning,
  ShieldCheck,
} from "lucide-react";
import {
  motion,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
} from "motion/react";

const stages = [
  { label: "Report", detail: "An exception with context", icon: FileWarning },
  { label: "Act", detail: "A controlled recovery command", icon: ShieldCheck },
  { label: "Confirm", detail: "An outcome from the origin", icon: CheckCheck },
];

export function RecoveryFlow() {
  return (
    <figure className="recovery-flow">
      <figcaption>THE RECOVERY LOOP</figcaption>
      <ol>
        {stages.map((stage, index) => (
          <li key={stage.label}>
            <span className="flow-symbol">
              <stage.icon size={18} aria-hidden="true" />
            </span>
            <span>
              <strong>{stage.label}</strong>
              <small>{stage.detail}</small>
            </span>
            <span className="flow-index" aria-hidden="true">
              0{index + 1}
            </span>
          </li>
        ))}
      </ol>
      <p>A command can succeed before a case is resolved.</p>
    </figure>
  );
}

const chapters = [
  {
    title: "Start with the exception.",
    description:
      "A vendor cannot complete onboarding because its country is missing. The origin reports the failure; RecoveryPlane keeps the entity, workflow, and recovery actions together in one case.",
    evidence: "Country missing",
    outcome: "Case open",
    note: "The report explains what needs attention.",
  },
  {
    title: "A successful patch is one step.",
    description:
      "An operator supplies the country and runs the registered action. The origin applies the change and confirms the command succeeded. The case stays open: verification still needs to run.",
    evidence: "Country updated",
    outcome: "Case still open",
    note: "Command success is recorded separately from case resolution.",
  },
  {
    title: "Recovery ends at the origin.",
    description:
      "The operator retries verification. When the origin confirms that onboarding is healthy and reports a resolved disposition, the case moves to Recovered. The audit trail connects every step.",
    evidence: "Verification confirmed",
    outcome: "Case recovered",
    note: "The origin decides whether the workflow has recovered.",
  },
];

export function RecoveryWalkthrough() {
  const target = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();
  const [active, setActive] = useState(0);
  const { scrollYProgress } = useScroll({
    target,
    offset: ["start center", "end center"],
  });
  useMotionValueEvent(scrollYProgress, "change", (progress) => {
    setActive(Math.min(2, Math.floor(progress * 3)));
  });

  return (
    <section
      className="recovery-walkthrough"
      aria-labelledby="recovery-walkthrough-title"
    >
      <div className="recovery-walkthrough-heading">
        <div>
          <p className="eyebrow">A RECOVERY, STEP BY STEP</p>
          <h2 id="recovery-walkthrough-title">
            Fixed data. Confirmed recovery.
          </h2>
          <p>They are different milestones. Here’s how they connect.</p>
        </div>
        <span className="illustration-label">Illustrative walkthrough</span>
      </div>
      <div className="recovery-walkthrough-body" ref={target}>
        <div className="recovery-map" aria-hidden="true">
          <div className="recovery-map-heading">
            <span>VENDOR ONBOARDING</span>
            <ArrowDown size={16} />
          </div>
          <div className="recovery-map-flow">
            <div className="recovery-map-track">
              <motion.div
                style={{
                  scaleY: reducedMotion ? 1 : scrollYProgress,
                  originY: 0,
                }}
              />
            </div>
            {stages.map((stage, index) => (
              <div
                key={stage.label}
                className={`recovery-map-node ${active === index ? "is-current" : ""} ${active > index ? "is-past" : ""}`}
              >
                <span className="recovery-map-icon">
                  {active > index ? (
                    <Check size={18} />
                  ) : (
                    <stage.icon size={18} />
                  )}
                </span>
                <div>
                  <span className="recovery-map-number">0{index + 1}</span>
                  <strong>{stage.label}</strong>
                  <small>{stage.detail}</small>
                </div>
              </div>
            ))}
          </div>
          <div className="recovery-map-caption">
            <ShieldCheck size={17} />
            <span>
              Every action has evidence.
              <br />
              Only the origin confirms recovery.
            </span>
          </div>
        </div>
        <ol className="recovery-chapters">
          {chapters.map((chapter, index) => (
            <li
              key={chapter.title}
              className={`recovery-chapter ${active === index ? "is-current" : ""}`}
            >
              <span className="chapter-index">
                0{index + 1} / {stages[index]!.label}
              </span>
              <h3>{chapter.title}</h3>
              <p>{chapter.description}</p>
              <div
                className={`chapter-evidence ${index === 2 ? "is-recovered" : ""}`}
              >
                <span>
                  {index === 0 ? (
                    <FileWarning size={14} aria-hidden="true" />
                  ) : (
                    <Check size={14} aria-hidden="true" />
                  )}
                  {chapter.evidence}
                </span>
                <strong>{chapter.outcome}</strong>
              </div>
              <p className="chapter-note">{chapter.note}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
