export type BadgeTone = "success" | "warning" | "danger" | "info" | "neutral";

const TONES: Record<BadgeTone, string> = {
  success: "bg-success/10 text-success",
  warning: "bg-warning/15 text-amber-800",
  danger: "bg-danger/10 text-danger",
  info: "bg-brand-soft text-brand-strong",
  neutral: "bg-slate-100 text-slate-600",
};

export default function StatusBadge({
  label,
  tone,
}: {
  label: string;
  tone: BadgeTone;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${TONES[tone]}`}
    >
      <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
      {label}
    </span>
  );
}