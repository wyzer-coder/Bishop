"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";

// The same QR a physical unit label would carry — scanning it (any phone
// camera, no app) opens the public /scan/[id] provenance page. Doubles as
// the hardware-free demo fallback: if RFID scanning isn't working on stage,
// scan this on screen instead and the exact same custody chain comes up.
export function ProvenanceQr({ unitId, size = 160 }: { unitId: string; size?: number }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const target = `${window.location.origin}/scan/${unitId}`;
    setUrl(target);
    QRCode.toDataURL(target, { width: size, margin: 1, color: { dark: "#1b2a4a", light: "#ffffff" } })
      .then(setDataUrl)
      .catch(() => setDataUrl(null));
  }, [unitId, size]);

  if (!dataUrl) return null;

  return (
    <div className="flex flex-col items-center gap-2">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={dataUrl} alt="Provenance QR code" width={size} height={size} className="rounded-md border border-border" />
      <a href={url ?? "#"} target="_blank" rel="noreferrer" className="text-xs text-muted-foreground hover:underline">
        Open scan page
      </a>
    </div>
  );
}
