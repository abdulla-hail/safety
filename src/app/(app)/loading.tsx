/** يظهر فورًا عند التنقل بين الأقسام بينما تُجلب بيانات الصفحة من الخادم. */
export default function Loading() {
  return (
    <div className="overlay-enter space-y-6" role="status" aria-live="polite" aria-label="جارٍ تحميل الصفحة">
      <div className="flex items-center gap-3">
        <div className="skeleton h-8 w-56 rounded-lg" />
        <span className="spinner text-brand" aria-hidden="true" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => <div key={i} className="skeleton h-24 rounded-xl" />)}
      </div>
      <div className="space-y-2 rounded-xl border border-slate-200 bg-card p-5">
        {Array.from({ length: 6 }, (_, i) => <div key={i} className="skeleton h-5 rounded" />)}
      </div>
      <p className="sr-only">جارٍ التحميل...</p>
    </div>
  );
}
