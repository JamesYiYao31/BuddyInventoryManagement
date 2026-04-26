"use client"

import { useEffect, useRef, useState } from "react"
import { FlipHorizontal2 } from "lucide-react"
import { BrowserMultiFormatReader, IScannerControls } from "@zxing/browser"

interface BarcodeCameraScannerProps {
  onResult: (code: string) => void
  onError?: (error: string) => void
  active: boolean
}

const CAMERA_UNAVAILABLE_MESSAGE = "Camera not available. Use USB scanner or type lot number below."
const HTTPS_REQUIRED_MESSAGE = "Camera scanning requires a secure connection (HTTPS). Use USB scanner or type lot number manually."

export default function BarcodeCameraScanner({ onResult, onError, active }: BarcodeCameraScannerProps) {
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment")
  const videoRef = useRef<HTMLVideoElement>(null)
  const readerRef = useRef<BrowserMultiFormatReader | null>(null)
  const controlsRef = useRef<IScannerControls | null>(null)
  const pauseUntilRef = useRef<number>(0)

  const stopStream = () => {
    const videoEl = videoRef.current
    const stream = videoEl?.srcObject as MediaStream | null
    stream?.getTracks().forEach(track => track.stop())
    if (videoEl) videoEl.srcObject = null
  }

  const stopScanner = () => {
    controlsRef.current?.stop()
    controlsRef.current = null
    stopStream()
  }

  useEffect(() => {
    if (!active) {
      stopScanner()
      return
    }

    if (typeof window === "undefined" || !window.isSecureContext) {
      stopScanner()
      return
    }

    const videoEl = videoRef.current
    if (!videoEl) return

    const reader = new BrowserMultiFormatReader()
    readerRef.current = reader
    let cancelled = false

    const handleCameraFailure = () => {
      if (!cancelled) onError?.(CAMERA_UNAVAILABLE_MESSAGE)
      stopScanner()
    }

    const startScan = async () => {
      try {
        const controls = await reader.decodeFromConstraints(
          {
            video: {
              facingMode: { ideal: facingMode },
            },
          },
          videoEl,
          (result) => {
            if (!result) return
            const now = Date.now()
            if (now < pauseUntilRef.current) return
            pauseUntilRef.current = now + 1000
            onResult(result.getText())
          }
        )
        if (cancelled) {
          controls.stop()
          return
        }
        controlsRef.current = controls
      } catch {
        handleCameraFailure()
      }
    }

    void startScan()

    return () => {
      cancelled = true
      stopScanner()
    }
  }, [active, facingMode, onError, onResult])

  if (typeof window !== "undefined" && !window.isSecureContext) {
    return (
      <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-5 py-4 text-left text-sm text-amber-700">
        {HTTPS_REQUIRED_MESSAGE}
      </div>
    )
  }

  return (
    <div className="relative h-56 overflow-hidden rounded-[2rem] border border-border bg-black/80">
      <video ref={videoRef} className="h-full w-full object-cover" autoPlay playsInline muted />
      <button
        type="button"
        onClick={() => setFacingMode(prev => (prev === "environment" ? "user" : "environment"))}
        className="absolute right-3 top-3 z-10 rounded-xl border border-white/20 bg-black/60 p-2 text-white transition-all hover:bg-black/75"
        aria-label="Flip camera"
      >
        <FlipHorizontal2 className="size-4" />
      </button>
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="relative h-32 w-56">
          <span className="absolute left-0 top-0 h-8 w-8 border-l-4 border-t-4 border-green-400" />
          <span className="absolute right-0 top-0 h-8 w-8 border-r-4 border-t-4 border-green-400" />
          <span className="absolute bottom-0 left-0 h-8 w-8 border-b-4 border-l-4 border-green-400" />
          <span className="absolute bottom-0 right-0 h-8 w-8 border-b-4 border-r-4 border-green-400" />
        </div>
      </div>
    </div>
  )
}
