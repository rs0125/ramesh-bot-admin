'use client';
/** Renders the current QR in memory; nothing is uploaded or saved to browser storage. */
import { useEffect, useRef } from 'react';
import QRCode from 'qrcode';

export function PairingCode({ value }: { value: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (canvas.current)
      void QRCode.toCanvas(canvas.current, value, {
        // Whole pixels per module and the full quiet zone keep dense WhatsApp QRs readable.
        scale: 4,
        margin: 4,
        errorCorrectionLevel: 'M',
      });
  }, [value]);
  return (
    <canvas
      ref={canvas}
      className="qr-code"
      role="img"
      aria-label="Scan this QR code with WhatsApp Linked devices"
    />
  );
}
