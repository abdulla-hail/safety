"use client";

/** تحديد/إلغاء تحديد كل خانات النموذج المحدد في الصفحة الحالية. */
export default function SelectAllCheckbox({ form, name = "ids", label = "تحديد الكل في هذه الصفحة" }: { form: string; name?: string; label?: string }) {
  return (
    <label className="flex items-center gap-2 text-xs text-slate-600">
      <input type="checkbox" className="size-4 accent-[var(--brand)]" aria-label={label}
        onChange={(e) => document.querySelectorAll<HTMLInputElement>(`input[type=checkbox][form="${form}"][name="${name}"]`)
          .forEach((x) => { x.checked = e.currentTarget.checked; })} />
      {label}
    </label>
  );
}
