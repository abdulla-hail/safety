/** علامة المنصة: الشعار المرفوع من مالك المنصة، أو الرمز الافتراضي إن لم يُرفع شعار */
export default function PlatformMark({ logoUrl, className = "size-14" }: { logoUrl: string | null; className?: string }) {
  if (logoUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={logoUrl} alt="شعار عين السلامة" className={`${className} mx-auto object-contain`} />;
  }
  return (
    <div className={`${className} mx-auto flex items-center justify-center rounded-xl bg-[#1e3a5f] text-white`}>
      <svg viewBox="0 0 24 24" className="size-3/5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        <circle cx="12" cy="11" r="3" />
      </svg>
    </div>
  );
}
