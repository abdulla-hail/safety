"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import jsQR from "jsqr";
import { btnPrimary, btnSecondary, input } from "@/components/ui/styles";

/** يستخرج رمز الجهاز من رابط QR (‎/d/TOKEN) أو من قيمة الباركود المباشرة. */
export function extractToken(raw: string): string | null {
  const v = raw.trim();
  const fromUrl = v.match(/\/d\/([A-Za-z0-9]{8,32})(?:[/?#]|$)/);
  if (fromUrl) return fromUrl[1].toUpperCase();
  if (/^[A-Za-z0-9]{8,32}$/.test(v)) return v.toUpperCase();
  return null;
}

interface Detector { detect(src: CanvasImageSource): Promise<{ rawValue: string }[]> }

export default function Scanner() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [active, setActive] = useState(false);
  const [message, setMessage] = useState("");
  const [manual, setManual] = useState("");

  useEffect(() => {
    if (!active) return;
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    const BD = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
    const detector = BD ? new BD({ formats: ["qr_code", "code_128"] }) : null;

    function found(raw: string) {
      const t = extractToken(raw);
      if (t) {
        stopped = true;
        setMessage("تم التعرف على الرمز، جارٍ فتح الجهاز...");
        router.push(`/d/${t}`);
      } else {
        setMessage("رمز غير تابع للمنصة.");
      }
    }

    async function tick() {
      if (stopped) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (video && canvas && video.readyState >= 2) {
        try {
          if (detector) {
            const codes = await detector.detect(video);
            if (codes[0]) return found(codes[0].rawValue);
          } else {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const g = canvas.getContext("2d", { willReadFrequently: true });
            if (g) {
              g.drawImage(video, 0, 0);
              const img = g.getImageData(0, 0, canvas.width, canvas.height);
              const code = jsQR(img.data, img.width, img.height);
              if (code?.data) return found(code.data);
            }
          }
        } catch { /* إطار غير صالح؛ المتابعة */ }
      }
      raf = requestAnimationFrame(tick);
    }

    navigator.mediaDevices?.getUserMedia({ video: { facingMode: "environment" } })
      .then((s) => {
        stream = s;
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          void videoRef.current.play();
        }
        raf = requestAnimationFrame(tick);
      })
      .catch(() => setMessage("تعذر تشغيل الكاميرا. اسمح بالوصول للكاميرا أو أدخل الرمز يدويًا."));

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [active, router]);

  return (
    <div className="space-y-5">
      <div className="overflow-hidden rounded-xl bg-black">
        <video ref={videoRef} className={`aspect-video w-full object-cover ${active ? "" : "hidden"}`} muted playsInline />
        {!active && <div className="flex aspect-video items-center justify-center text-sm text-white/70">الكاميرا متوقفة</div>}
        <canvas ref={canvasRef} className="hidden" />
      </div>
      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={() => { setMessage(""); setActive((a) => !a); }} className={btnPrimary}>
          {active ? "إيقاف الكاميرا" : "تشغيل الكاميرا والمسح"}
        </button>
      </div>
      {message && <p role="status" className="text-sm text-slate-700">{message}</p>}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const t = extractToken(manual);
          if (t) router.push(`/d/${t}`); else setMessage("أدخل رمز الجهاز (12 حرفًا) أو رابط الملصق.");
        }}
        className="flex flex-wrap gap-2 border-t border-slate-200 pt-5"
      >
        <label htmlFor="manual" className="sr-only">رمز الجهاز</label>
        <input id="manual" value={manual} onChange={(e) => setManual(e.target.value)} dir="ltr" placeholder="رمز الجهاز أو رابط الملصق أو قراءة ماسح الباركود"
          className={`${input} max-w-md font-mono`} autoComplete="off" />
        <button type="submit" className={btnSecondary}>فتح</button>
      </form>
    </div>
  );
}
