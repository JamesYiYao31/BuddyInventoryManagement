"use client"

import { useEffect, useRef } from "react"
import { BrowserMultiFormatReader } from "@zxing/browser"

interface BarcodeCameraScannerProps {
  onResult: (code: string) => void
  onError?: (error: string) => void
  active: boolean
}

const CAMERA_UNAVAILABLE_MESSAGE = "Camera not available. Use USB scanner or type lot number below."
const HTTPS_REQUIRED_MESSAGE = "Camera scanning requires a secure connection (HTTPS). Use USB scanner or type lot number manually."

export default function BarcodeCameraScanner({ onResult, onError, active }: BarcodeCameraScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const readerRef = useRef<BrowserMultiFormatReader | null>(null)
  const pauseUntilRef = useRef<number>(0)

  const stopStream = () => {
    const videoEl = videoRef.current
    const stream = videoEl?.srcObject as MediaStream | null
    stream?.getTracks().forEach(track => track.stop())
    if (videoEl) videoEl.srcObject = null
  }

  const stopScanner = () => {
    readerRef.current?.reset()
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
        await reader.decodeFromConstraints(
          {
            video: {
              facingMode: { exact: "environment" },
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
      } catch {
        try {
          await reader.decodeFromConstraints(
            {
              video: true,
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
        } catch {
          handleCameraFailure()
        }
      }
    }

    void startScan()

    return () => {
      cancelled = true
      stopScanner()
    }
  }, [active, onError, onResult])

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
