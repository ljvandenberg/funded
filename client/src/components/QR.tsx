import { useEffect, useState } from "react";
import QRCode from "qrcode";

export function QR({ value, size = 240 }: { value: string; size?: number }) {
  const [src, setSrc] = useState<string>("");
  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(value, { width: size, margin: 1, errorCorrectionLevel: "M" })
      .then((s) => alive && setSrc(s))
      .catch(() => alive && setSrc(""));
    return () => {
      alive = false;
    };
  }, [value, size]);
  if (!src) return <div style={{ width: size, height: size }} />;
  return <img src={src} width={size} height={size} alt={`QR code for ${value}`} style={{ display: "block" }} />;
}
