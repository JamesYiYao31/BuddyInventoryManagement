"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { FlipHorizontal2, Sun, SunDim } from "lucide-react"
import { BrowserMultiFormatReader, IScannerControls } from "@zxing/browser"
import { DecodeHintType, BarcodeFormat } from "@zxing/library"

interface BarcodeCameraScannerProps {
  onResult: (code: string) => void
  onError?: (error: string) => void
  active: boolean
}

const CAMERA_UNAVAILABLE_MESSAGE =
  "Camera not available. Use USB scanner or type lot number below."
const HTTPS_REQUIRED_MESSAGE =
  "Camera scanning requires a secure connection (HTTPS). Use USB scanner or type lot number manually."

// Formats we actually care about for lab reagent barcodes.
// Whitelisting stops ZXing wasting cycles on QR, EAN, DataMatrix etc.
const SUPPORTED_FORMATS = [
  BarcodeFormat.CODE_128,
  BarcodeFormat.CODE_39,
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.ITF, // some HIBC labels use ITF-14
  BarcodeFormat.DATA_MATRIX,
]

// How long to wait before accepting another scan (ms).
// Stacked barcodes get a shorter window on the second pass.
const COOLDOWN_MS = 1200
const STACKED_RETRY_DELAY_MS = 350

function buildReader(): BrowserMultiFormatReader {
  const hints = new Map()
  hints.set(DecodeHintType.POSSIBLE_FORMATS, SUPPORTED_FORMATS)
  // TRY_HARDER tells ZXing to spend more CPU time decoding —
  // critical for long GS1-128 barcodes that span a wide label.
  hints.set(DecodeHintType.TRY_HARDER, true)
  // CHARACTER_SET helps with some GS1 extended characters
  hints.set(DecodeHintType.CHARACTER_SET, "UTF-8")
  return new BrowserMultiFormatReader(hints)
}

// Detect if the device likely supports torch (Android Chrome/Firefox).
// iOS Safari does not expose torch through the web API.
function isTorchLikelySupported(): boolean {
  if (typeof navigator === "undefined") return false
  const ua = navigator.userAgent
  const isIOS = /iPad|iPhone|iPod/.test(ua)
  return !isIOS
}

export default function BarcodeCameraScanner({
  onResult,
  onError,
  active,
}: BarcodeCameraScannerProps) {
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment")
  const [torchOn, setTorchOn] = useState(false)
  const [torchSupported, setTorchSupported] = useState(false)
  const [scanFeedback, setScanFeedback] = useState<"idle" | "success" | "retry">("idle")

  const videoRef = useRef<HTMLVideoElement>(null)
  const readerRef = useRef<BrowserMultiFormatReader | null>(null)
  const controlsRef = useRef<IScannerControls | null>(null)
  const pauseUntilRef = useRef<number>(0)
  const lastRawRef = useRef<string>("")

  const stopStream = useCallback(() => {
    const videoEl = videoRef.current
    const src = videoEl?.srcObject
    if (src instanceof MediaStream) src.getTracks().forEach((t) => t.stop())
    if (videoEl) videoEl.srcObject = null
  }, [])

  const stopScanner = useCallback(() => {
    controlsRef.current?.stop()
    controlsRef.current = null
    stopStream()
  }, [stopStream])

  // Apply torch on/off to the live stream track.
  // We call this separately from startScan so toggling doesn't restart the camera.
  const applyTorch = useCallback(async (on: boolean) => {
    const src = videoRef.current?.srcObject
    const stream = src instanceof MediaStream ? src : null
    if (!stream) return
    const track = stream.getVideoTracks()[0]
    if (!track) return
    try {
      await track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] })
    } catch {
      // Torch not supported on this device — hide the button
      setTorchSupported(false)
    }
  }, [])

  const handleToggleTorch = useCallback(() => {
    const next = !torchOn
    setTorchOn(next)
    void applyTorch(next)
  }, [torchOn, applyTorch])

  useEffect(() => {
    if (!active) {
      stopScanner()
      setTorchOn(false)
      setScanFeedback("idle")
      return
    }

    if (typeof window === "undefined" || !window.isSecureContext) {
      stopScanner()
      return
    }

    const videoEl = videoRef.current
    if (!videoEl) return

    const reader = buildReader()
    readerRef.current = reader
    let cancelled = false

    const handleCameraFailure = () => {
      if (!cancelled) onError?.(CAMERA_UNAVAILABLE_MESSAGE)
      stopScanner()
    }

    const startScan = async () => {
      try {
        // Advanced constraints for better autofocus and resolution on iOS/Android.
        // focusMode 'continuous' is the key iOS improvement — without it,
        // the camera locks focus after the first frame and never re-adjusts.
        const videoConstraints: MediaTrackConstraints = {
          facingMode: { ideal: facingMode },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          advanced: [
            { focusMode: "continuous" },
            { exposureMode: "continuous" },
            { whiteBalanceMode: "continuous" },
          ] as any,
        }

        const controls = await reader.decodeFromConstraints(
          { video: videoConstraints },
          videoEl,
          (result, error) => {
            if (!result) return
            const now = Date.now()
            if (now < pauseUntilRef.current) return

            const raw = result.getText()

            // ── Stacked barcode handling ──
            // Image 1 on your labels has TWO barcodes stacked vertically.
            // After decoding the first one, we set a short retry window.
            // If a DIFFERENT barcode comes in during that window, we emit both.
            const isNewBarcode = raw !== lastRawRef.current
            if (isNewBarcode && lastRawRef.current !== "") {
              // Second barcode in a stack — emit it and clear
              setScanFeedback("success")
              pauseUntilRef.current = now + COOLDOWN_MS
              lastRawRef.current = ""
              onResult(raw)
              setTimeout(() => setScanFeedback("idle"), 800)
              return
            }

            // First decode — emit immediately, then watch for a stacked second
            lastRawRef.current = raw
            setScanFeedback("success")
            onResult(raw)

            // Short pause for stacked detection, then full cooldown
            pauseUntilRef.current = now + STACKED_RETRY_DELAY_MS
            setScanFeedback("retry")
            setTimeout(() => {
              pauseUntilRef.current = Date.now() + (COOLDOWN_MS - STACKED_RETRY_DELAY_MS)
              lastRawRef.current = ""
              setScanFeedback("idle")
            }, STACKED_RETRY_DELAY_MS + 100)
          }
        )

        if (cancelled) {
          controls.stop()
          return
        }
        controlsRef.current = controls

        const stream = videoEl.srcObject
        if (stream instanceof MediaStream && isTorchLikelySupported()) {
          const track = stream.getVideoTracks()[0]
          const caps = track?.getCapabilities?.() as Record<string, unknown> | undefined
          if (caps && "torch" in caps) setTorchSupported(true)
        }
      } catch {
        handleCameraFailure()
      }
    }

    void startScan()

    return () => {
      cancelled = true
      stopScanner()
    }
  }, [active, facingMode, onError, onResult, stopScanner])

  if (typeof window !== "undefined" && !window.isSecureContext) {
    return (
      <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-5 py-4 text-left text-sm text-amber-700">
        {HTTPS_REQUIRED_MESSAGE}
      </div>
    )
  }

  // Box border color reflects scan state:
  // green = idle/ready, blue = just scanned, amber = watching for stacked barcode
  const boxColor =
    scanFeedback === "success"
      ? "border-blue-400"
      : scanFeedback === "retry"
      ? "border-amber-400"
      : "border-green-400"

  const cornerColor =
    scanFeedback === "success"
      ? "border-blue-400"
      : scanFeedback === "retry"
      ? "border-amber-400"
      : "border-green-400"

  return (
    <div className="relative overflow-hidden rounded-[2rem] border border-border bg-black/80"
         style={{ height: "13rem" }}>
      <video
        ref={videoRef}
        className="h-full w-full object-cover"
        autoPlay
        playsInline
        muted
      />

      {/* ── Flip camera button ── */}
      <button
        type="button"
        onClick={() => {
          setFacingMode((prev) => (prev === "environment" ? "user" : "environment"))
          setTorchOn(false)
        }}
        className="absolute right-3 top-3 z-10 rounded-xl border border-white/20 bg-black/60 p-2 text-white transition-all hover:bg-black/75"
        aria-label="Flip camera"
      >
        <FlipHorizontal2 className="size-4" />
      </button>

      {/* ── Torch button — Android only, hidden on iOS ── */}
      {torchSupported && (
        <button
          type="button"
          onClick={handleToggleTorch}
          className={`absolute right-12 top-3 z-10 rounded-xl border p-2 text-white transition-all ${
            torchOn
              ? "border-yellow-400/60 bg-yellow-500/40 hover:bg-yellow-500/50"
              : "border-white/20 bg-black/60 hover:bg-black/75"
          }`}
          aria-label={torchOn ? "Turn off flashlight" : "Turn on flashlight"}
        >
          {torchOn ? <Sun className="size-4" /> : <SunDim className="size-4" />}
        </button>
      )}

      {/* ── Scan region overlay ──
          Wider (w-72 on small screens, w-80 on larger) and shorter (h-20) than before.
          GS1-128 barcodes are very wide and short — matching the box to their
          aspect ratio helps ZXing find and decode them faster. ── */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        {/* Dimmed overlay outside the scan box */}
        <div className="absolute inset-0 bg-black/30" />
        <div className={`relative z-10 h-20 w-72 sm:w-80 rounded-sm border ${boxColor} bg-transparent transition-colors duration-200`}>
          {/* Corner brackets */}
          <span className={`absolute left-0 top-0 h-6 w-6 border-l-4 border-t-4 ${cornerColor} transition-colors duration-200`} />
          <span className={`absolute right-0 top-0 h-6 w-6 border-r-4 border-t-4 ${cornerColor} transition-colors duration-200`} />
          <span className={`absolute bottom-0 left-0 h-6 w-6 border-b-4 border-l-4 ${cornerColor} transition-colors duration-200`} />
          <span className={`absolute bottom-0 right-0 h-6 w-6 border-b-4 border-r-4 ${cornerColor} transition-colors duration-200`} />

          {/* Scan line animation */}
          <div className="absolute inset-x-0 top-0 h-0.5 animate-scan-line bg-green-400/70" />
        </div>

        {/* Status label below the box */}
        <div className="absolute bottom-3 left-0 right-0 flex justify-center">
          <span className="rounded-full bg-black/60 px-3 py-1 text-xs text-white/70">
            {scanFeedback === "success" && "✓ Scanned"}
            {scanFeedback === "retry" && "Looking for second barcode…"}
            {scanFeedback === "idle" && "Align barcode in box"}
          </span>
        </div>
      </div>
    </div>
  )
}