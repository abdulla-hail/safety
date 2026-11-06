import Link from "next/link";
import Icon, { type IconName } from "@/components/ui/Icon";

type StatTone = "primary" | "danger" | "warning" | "success";

const ICON_TONES: Record<StatTone, string> = {
  primary: "bg-brand-soft text-brand-icon",
  danger: "bg-danger/10 text-danger",
  warning: "bg-warning/15 text-amber-700",
  success: "bg-success/10 text-success",
};

interface StatCardProps {
  title: string;
  value: number;
  hint: string;
  icon: IconName;
  tone?: StatTone;
  href?: string;
}

export default function StatCard({ title, value, hint, icon, tone = "primary", href }: StatCardProps) {
  const body = (
    <>
      <div className={`flex size-12 shrink-0 items-center justify-center rounded-lg transition-transform duration-200 group-hover:scale-110 ${ICON_TONES[tone]}`}>
        <Icon name={icon} className="size-6" />
      </div>
      <div className="min-w-0">
        <p className="text-sm text-slate-500">{title}</p>
        <p className="mt-1 text-3xl font-extrabold text-foreground">{value}</p>
        <p className="mt-1 text-xs text-slate-500">{hint}</p>
      </div>
    </>
  );
  const cls = "group flex items-start gap-4 rounded-xl border border-slate-200 bg-card p-5 shadow-sm";
  return href ? <Link href={href} className={`${cls} transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-brand hover:shadow-md active:translate-y-0`}>{body}</Link> : <div className={cls}>{body}</div>;
}
