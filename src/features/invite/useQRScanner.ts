import { useCallback, useEffect, useRef, useState } from "react";
import jsQR from "jsqr";

export type QRScanResult = {
  text: string;
  ts: number;
};

type ScanOptions = {
  onScan: (result: QRScanResult) => void;
  /** Throttle duplicate scans of the same payload within N ms (default 1500). */
  cooldownMs?: number;
};

export type QRScannerHandle = {
  videoRef: (el: HTMLVideoElement | null) => void;
  scanning: boolean;
  error: string | null;
  start: () => Promise<void>;
  stop: () => void;
};

/**
 * Hook around getUserMedia + jsQR. Decodes QR codes from the device camera at
 * ~5 fps. Pass an iOS-compatible user gesture before calling start() (a button
 * click) — iOS Safari blocks getUserMedia outside of one.
 *
 * Ported from mesh-common/src/useQRScanner.ts.
 */
export function useQRScanner(opts: ScanOptions): QRScannerHandle {
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const videoElRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastTextRef = useRef<{ text: string; ts: number } | null>(null);
  const onScanRef = useRef(opts.onScan);
  const cooldown = opts.cooldownMs ?? 1500;

  useEffect(() => {
    onScanRef.current = opts.onScan;
  }, [opts.onScan]);

  const stop = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoElRef.current) {
      videoElRef.current.srcObject = null;
    }
    setScanning(false);
  }, []);

  const start = useCallback(async () => {
    if (scanning) return;
    setError(null);
    if (!("mediaDevices" in navigator) || !navigator.mediaDevices.getUserMedia) {
      setError("camera not supported in this browser");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false
      });
      streamRef.current = stream;
      const video = videoElRef.current;
      if (!video) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      video.srcObject = stream;
      await video.play().catch(() => {});
      setScanning(true);

      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) {
        setError("canvas 2d context unavailable");
        stop();
        return;
      }

      let lastTick = 0;
      const tick = (ts: number) => {
        rafRef.current = requestAnimationFrame(tick);
        if (ts - lastTick < 200) return;
        lastTick = ts;
        if (video.readyState !== video.HAVE_ENOUGH_DATA) return;
        if (!video.videoWidth || !video.videoHeight) return;
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(img.data, img.width, img.height, {
          inversionAttempts: "dontInvert"
        });
        if (code?.data) {
          const now = Date.now();
          const last = lastTextRef.current;
          if (!last || last.text !== code.data || now - last.ts > cooldown) {
            lastTextRef.current = { text: code.data, ts: now };
            onScanRef.current({ text: code.data, ts: now });
          }
        }
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setScanning(false);
    }
  }, [scanning, cooldown, stop]);

  useEffect(() => {
    return () => stop();
  }, [stop]);

  const videoRef = useCallback((el: HTMLVideoElement | null) => {
    videoElRef.current = el;
  }, []);

  return { videoRef, scanning, error, start, stop };
}
