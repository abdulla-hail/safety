"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";
import type { Map as LeafletMap, Marker } from "leaflet";
import { btnSecondary, btnSm, input, label as labelCls } from "@/components/ui/styles";
import { classifyLocation, DEFAULT_CENTER, LOCATION_KIND_LABEL, locationHref, parseLocation, type LatLng } from "@/lib/geo";

/**
 * موقع الفرع. حقل «الموقع» يقبل أي نص: رابط خرائط Google (ومنه المختصر maps.app.goo.gl)، أو إحداثيات عشرية،
 * أو درجات ودقائق وثوانٍ (24°44'12.8"N 46°50'06.9"E)، أو العنوان الوطني/وصف نصي.
 * - النص يُرسل مع النموذج كما هو تمامًا (location_text) ولا يُرفض أو يُستبدل أبدًا، حتى لو كان غير صحيح.
 * - «تطبيق» يعتمد النص ويحاول منفصلًا استخراج نقطة على الخريطة؛ إن تعذر يبقى النص وتبقى النقطة كما هي.
 * - النقطة (latitude/longitude) تُحدد أيضًا بالنقر على الخريطة أو «موقعي الحالي». عند الحفظ، إن لم تُحدد نقطة يحاول الخادم
 *   استخراجها من النص (ومن الرابط المختصر) دون أن يمنع الحفظ.
 */
export default function LocationPicker({ initial, initialText = null }: { initial: LatLng | null; initialText?: string | null }) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | null>(null);
  const pin = useRef<Marker | null>(null);
  const [pos, setPos] = useState<LatLng | null>(initial);
  const [text, setText] = useState(initialText ?? "");
  const [applied, setApplied] = useState(initialText ?? "");
  const [cleared, setCleared] = useState(false);
  const [msg, setMsg] = useState("");
  const setter = useRef<(p: LatLng | null, fly?: boolean) => void>(() => {});

  useEffect(() => {
    let cancelled = false;
    void import("leaflet").then(({ default: L }) => {
      if (cancelled || !box.current) return;
      const start = initial ?? DEFAULT_CENTER;
      const m = L.map(box.current).setView([start.lat, start.lng], initial ? 16 : 6);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap" }).addTo(m);
      const icon = L.divIcon({ className: "", html: '<span class="ays-pin"></span>', iconSize: [22, 22], iconAnchor: [11, 22] });
      setter.current = (p, fly = true) => {
        setPos(p);
        if (!p) { pin.current?.remove(); pin.current = null; return; }
        setCleared(false);
        if (!pin.current) {
          pin.current = L.marker([p.lat, p.lng], { icon, draggable: true }).addTo(m);
          pin.current.on("dragend", () => { const ll = pin.current!.getLatLng(); setPos({ lat: Math.round(ll.lat * 1e6) / 1e6, lng: Math.round(ll.lng * 1e6) / 1e6 }); });
        } else pin.current.setLatLng([p.lat, p.lng]);
        if (fly) m.setView([p.lat, p.lng], Math.max(m.getZoom(), 16));
      };
      if (initial) setter.current(initial, false);
      m.on("click", (e) => setter.current({ lat: Math.round(e.latlng.lat * 1e6) / 1e6, lng: Math.round(e.latlng.lng * 1e6) / 1e6 }, false));
      map.current = m;
    });
    return () => { cancelled = true; map.current?.remove(); map.current = null; pin.current = null; };
  }, [initial]);

  function locate() {
    if (!("geolocation" in navigator)) { setMsg("المتصفح لا يدعم تحديد الموقع."); return; }
    setMsg("جارٍ تحديد موقعك...");
    navigator.geolocation.getCurrentPosition(
      (p) => { setter.current({ lat: Math.round(p.coords.latitude * 1e6) / 1e6, lng: Math.round(p.coords.longitude * 1e6) / 1e6 }); setMsg(`تم (الدقة ≈ ${Math.round(p.coords.accuracy)} م).`); },
      () => setMsg("تعذر تحديد الموقع؛ اسمح للمتصفح بالوصول إلى الموقع أو حدده على الخريطة."),
      { enableHighAccuracy: true, timeout: 15000 });
  }

  /** اعتماد النص كما هو، ثم محاولة منفصلة لتحديد النقطة منه — لا يُمسح النص ولا يُرفض أبدًا */
  function apply() {
    setApplied(text);
    const kind = classifyLocation(text);
    if (kind === "empty") { setMsg("الحقل فارغ؛ سيُحفظ الفرع بلا نص موقع."); return; }
    const p = parseLocation(text);
    if (p) { setter.current(p); setMsg(`اعتُمد النص (${LOCATION_KIND_LABEL[kind]}) وحُددت النقطة منه على الخريطة.`); return; }
    const keep = pos ? " النقطة المحددة على الخريطة بقيت كما هي." : "";
    if (kind === "short_link") setMsg(`اعتُمد الرابط المختصر كما هو، ويُفتح في خرائط Google كما أدخلته. عند الحفظ يُحاول النظام استخراج الإحداثيات منه دون أن يمنع الحفظ.${keep}`);
    else if (kind === "map_link" || kind === "link") setMsg(`اعتُمد الرابط كما هو ويُفتح كما أدخلته.${keep}`);
    else setMsg(`اعتُمد النص كما هو (عنوان أو وصف)، ويُفتح بالبحث عنه في خرائط Google. يمكنك أيضًا تحديد النقطة بالنقر على الخريطة.${keep}`);
  }

  const kind = classifyLocation(text);
  const openHref = locationHref({ latitude: pos?.lat, longitude: pos?.lng, location_text: text });

  return (
    <div className="space-y-3">
      <div>
        <label htmlFor="loc-text" className={labelCls}>الموقع (رابط خرائط Google أو إحداثيات أو العنوان الوطني)</label>
        <div className="flex flex-wrap items-stretch gap-2">
          <input id="loc-text" name="location_text" value={text} maxLength={2000} autoComplete="off"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); apply(); } }}
            placeholder={`https://maps.app.goo.gl/…  أو  24°44'12.8"N 46°50'06.9"E  أو  8056-7958 الهفوف، الرياض 14243`}
            className={`${input} min-w-0 flex-1`} dir="auto" />
          <button type="button" onClick={apply} className={`${btnSecondary} ${btnSm}`}>تطبيق</button>
          {openHref && <a href={openHref} target="_blank" rel="noopener noreferrer" className={`${btnSecondary} ${btnSm} inline-flex items-center`}>📍 فتح في خرائط Google</a>}
        </div>
        <p className="mt-1 text-xs text-slate-500" aria-live="polite">
          {kind !== "empty" && <span className="me-1 rounded bg-slate-100 px-1.5 py-0.5 text-[11px]">{LOCATION_KIND_LABEL[kind]}</span>}
          {text !== applied && kind !== "empty" ? "اضغط «تطبيق» لاعتماد النص ومحاولة تحديد النقطة منه؛ يُحفظ النص كما هو في كل الأحوال. " : ""}{msg}
        </p>
      </div>

      <div className="space-y-2">
        <p className={labelCls}>النقطة على الخريطة</p>
        <div ref={box} className="z-0 h-72 w-full overflow-hidden rounded-lg border border-slate-200" role="application" aria-label="انقر لتحديد موقع الفرع" />
        <input type="hidden" name="latitude" value={pos?.lat ?? ""} />
        <input type="hidden" name="longitude" value={pos?.lng ?? ""} />
        <input type="hidden" name="location_cleared" value={cleared ? "1" : ""} />
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={locate} className={`${btnSecondary} ${btnSm}`}>موقعي الحالي</button>
          {pos && <button type="button" onClick={() => { setter.current(null); setCleared(true); setMsg("أُزيلت النقطة من الخريطة (النص يبقى كما هو)."); }} className="text-xs text-red-700 underline">إزالة النقطة</button>}
          <span className="text-xs text-slate-500">
            {pos ? <>المحدد: <span dir="ltr">{pos.lat}, {pos.lng}</span> — انقر الخريطة أو اسحب العلامة للتعديل.</> : "انقر على الخريطة لتحديد النقطة (اختياري)."}
          </span>
        </div>
      </div>
    </div>
  );
}
