import { OBJECTIVE_LABEL, type Objective } from "@funded/shared";

/**
 * The team's hidden objective as a colour-coded tag. Only render it where
 * the objective may be seen: the team's own screens, the host, the reveal.
 * Amber = Capital, blue = Validation, purple = Marketing.
 */
export function ObjectiveTag({ objective, small = false, prefix, plain = false }: { objective: Objective; small?: boolean; prefix?: string; plain?: boolean }) {
  if (plain) return <span className={`obj-text ${objective}`}>{OBJECTIVE_LABEL[objective]}</span>;
  return (
    <span className={`obj-tag ${objective}${small ? " small" : ""}`}>
      {prefix ? `${prefix}: ` : ""}{OBJECTIVE_LABEL[objective]}
    </span>
  );
}
