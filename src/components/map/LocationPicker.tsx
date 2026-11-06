"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";
import type { Map as LeafletMap, Marker } from "leaflet";
import { btnSecondary, btnSm, input, label as labelCls } from "@/components/ui/styles";
import { DEFAULT_CENTER, parseLocation, type LatLng } from "@/lib/geo";

/**
 * تحديد موقع الفرع: النقر على الخريطة، أو «موقعي الحالي» (من الجوال في الموقع)، أو لصق رابط خرائط Google أو الإحداثيات.
 * القيمة تُرسل مع النموذج في الحقلين latitude وlongitude (فارغان = بلا موقع).
 */
export default function LocationPicker({ initial }: { initial: LatLng | null }) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | null>(null);
  const pin = useRef<Marker | null>(null);
  const [pos, setPos] = useState<LatLng | null>(initial);
  const [paste, setPaste] = useState("");
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
  function applyPaste() {
    const p = parseLocation(paste);
    if (!p) { setMsg("لم أتعرف على الإحداثيات. الصق إحداثيات مثل 24.7136, 46.6753 أو رابط خرائط Google الكامل (الروابط المختصرة لا تحمل الإحداثيات)."); return; }
    setter.current(p); setMsg("تم تحديد الموقع."); setPaste("");
  }

  return (
    <div className="space-y-2">
      <p className={labelCls}>الموقع على الخريطة</p>
      <div ref={box} className="z-0 h-72 w-full overflow-hidden rounded-lg border border-slate-200" role="application" aria-label="انقر لتحديد موقع الفرع" />
      <input type="hidden" name="latitude" value={pos?.lat ?? ""} />
      <input type="hidden" name="longitude" value={pos?.lng ?? ""} />
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={locate} className={`${btnSecondary} ${btnSm}`}>موقعي الحالي</button>
        <input value={paste} onChange={(e) => setPaste(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); applyPaste(); } }}
          placeholder="الصق رابط خرائط Google أو الإحداثيات" aria-label="رابط أو إحداثيات" className={`${input} !w-auto min-w-0 flex-1 text-xs`} dir="ltr" />
        <button type="button" onClick={applyPaste} className={`${btnSecondary} ${btnSm}`}>تطبيق</button>
        {pos && <button type="button" onClick={() => { setter.current(null); setMsg("أُزيل الموقع."); }} className="text-xs text-red-700 underline">إزالة الموقع</button>}
      </div>
      <p className="text-xs text-slate-500" aria-live="polite">
        {pos ? <>المحدد: <span dir="ltr">{pos.lat}, {pos.lng}</span> — انقر الخريطة أو اسحب العلامة للتعديل.</> : "انقر على الخريطة لتحديد موقع الفرع."} {msg}
      </p>
    </div>
  );
}
