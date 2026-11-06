"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";
import type { Map as LeafletMap } from "leaflet";
import { DEFAULT_CENTER } from "@/lib/geo";

export interface MapMarker { lat: number; lng: number; label: string; href?: string; directions?: string }

/** خريطة تفاعلية (OpenStreetMap) لعرض مواقع الفروع؛ تُحمَّل في المتصفح فقط وتضبط التكبير على كل العلامات */
export default function MapView({ markers, height = 320 }: { markers: MapMarker[]; height?: number }) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | null>(null);
  const key = JSON.stringify(markers);

  useEffect(() => {
    let cancelled = false;
    void import("leaflet").then(({ default: L }) => {
      if (cancelled || !box.current) return;
      map.current?.remove();
      const m = L.map(box.current, { scrollWheelZoom: false }).setView([DEFAULT_CENTER.lat, DEFAULT_CENTER.lng], 5);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap" }).addTo(m);
      const icon = L.divIcon({ className: "", html: '<span class="ays-pin"></span>', iconSize: [22, 22], iconAnchor: [11, 22] });
      const pts = JSON.parse(key) as MapMarker[];
      for (const p of pts) {
        const el = document.createElement("div");
        const title = document.createElement(p.href ? "a" : "b");
        title.textContent = p.label;
        if (p.href) (title as HTMLAnchorElement).href = p.href;
        el.appendChild(title);
        if (p.directions) {
          const d = document.createElement("a");
          d.href = p.directions; d.target = "_blank"; d.rel = "noopener noreferrer"; d.textContent = "الاتجاهات ←";
          d.style.display = "block"; d.style.marginTop = "4px";
          el.appendChild(d);
        }
        L.marker([p.lat, p.lng], { icon, title: p.label }).addTo(m).bindPopup(el);
      }
      if (pts.length === 1) m.setView([pts[0].lat, pts[0].lng], 15);
      else if (pts.length > 1) m.fitBounds(L.latLngBounds(pts.map((p) => [p.lat, p.lng] as [number, number])), { padding: [30, 30], maxZoom: 15 });
      map.current = m;
    });
    return () => { cancelled = true; map.current?.remove(); map.current = null; };
  }, [key]);

  return <div ref={box} style={{ height }} className="z-0 w-full overflow-hidden rounded-lg border border-slate-200" role="region" aria-label="خريطة الفروع" />;
}
