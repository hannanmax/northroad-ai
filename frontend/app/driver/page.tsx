"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import dynamic from "next/dynamic"
import type { Hazard } from "@/lib/api"

const API = "http://localhost:8000"

const SEVERITY_COLOR: Record<string, string> = {
  HIGH: "#dc2626",
  MEDIUM: "#f59e0b",
  LOW: "#22c55e",
}

const LiveMap = dynamic(() => import("@/components/LiveMap"), { ssr: false })

type Phase = "idle" | "uploading" | "streaming" | "done"

interface AlertInfo {
  id: string
  message: string
  severity: string
}

interface Toast {
  id: string
  severity: string
  confidence: number
}

export default function DriverPage() {
  const [phase, setPhase] = useState<Phase>("idle")
  const [jobId, setJobId] = useState<string | null>(null)
  const [hazards, setHazards] = useState<Hazard[]>([])
  const [alert, setAlert] = useState<AlertInfo | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [progress, setProgress] = useState(0)
  const [carPos, setCarPos] = useState<[number, number] | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const sseRef = useRef<EventSource | null>(null)
  const alertTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showAlert = useCallback((h: Hazard) => {
    if (alertTimerRef.current) clearTimeout(alertTimerRef.current)
    setAlert({
      id: h.id,
      message: `⚠️ ${h.severity} POTHOLE — SLOW DOWN`,
      severity: h.severity,
    })
    alertTimerRef.current = setTimeout(() => setAlert(null), 4000)

    // Bottom-right "Reported to city" toast
    const tid = h.id + "_toast"
    setToasts((prev) => [...prev, { id: tid, severity: h.severity, confidence: h.confidence }])
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== tid)), 5000)
  }, [])

  const startSSE = useCallback(
    (jid: string) => {
      const es = new EventSource(`${API}/api/events/${jid}`)
      sseRef.current = es

      es.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data)
          if (data.type === "detection") {
            const h: Hazard = {
              id: data.id,
              job_id: jid,
              lat: data.lat,
              lng: data.lng,
              severity: data.severity,
              confidence: data.confidence,
              frame_file: data.frame_file,
              video_timestamp: data.video_timestamp,
              status: "open",
            }
            setHazards((prev) => [...prev, h])
            setCarPos([h.lat, h.lng])
            showAlert(h)
          } else if (data.type === "done") {
            setPhase("done")
            setProgress(100)
            es.close()
          } else if (data.type === "error") {
            setPhase("done")
            es.close()
          }
        } catch {}
      }

      es.onerror = () => {}
    },
    [showAlert]
  )

  // Poll progress while streaming
  useEffect(() => {
    if (phase !== "streaming" || !jobId) return
    const iv = setInterval(async () => {
      try {
        const res = await fetch(`${API}/api/jobs/${jobId}`)
        const job = await res.json()
        setProgress(job.progress ?? 0)
        if (job.status === "done") {
          setProgress(100)
          clearInterval(iv)
        }
      } catch {}
    }, 1000)
    return () => clearInterval(iv)
  }, [phase, jobId])

  useEffect(() => {
    return () => {
      sseRef.current?.close()
      if (alertTimerRef.current) clearTimeout(alertTimerRef.current)
    }
  }, [])

  const handleFile = useCallback(
    async (file: File) => {
      if (!file.type.startsWith("video/")) return
      setPhase("uploading")
      setHazards([])
      setProgress(0)
      setAlert(null)
      setCarPos(null)

      const form = new FormData()
      form.append("file", file)

      const res = await fetch(`${API}/api/upload`, { method: "POST", body: form })
      const { job_id } = await res.json()
      setJobId(job_id)
      setPhase("streaming")
      startSSE(job_id)
    },
    [startSSE]
  )

  const reset = () => {
    sseRef.current?.close()
    setPhase("idle")
    setJobId(null)
    setHazards([])
    setAlert(null)
    setToasts([])
    setProgress(0)
    setCarPos(null)
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  return (
    <div className="min-h-screen bg-[#0f1f2d] text-slate-100 flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-slate-700/50 shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-xl font-bold text-cyan-400">NorthRoad AI</span>
          <span className="text-slate-500 text-sm">Driver View</span>
        </div>
        {phase !== "idle" && (
          <button
            onClick={reset}
            className="text-xs text-slate-400 hover:text-white border border-slate-600 hover:border-slate-400 rounded px-3 py-1.5 transition"
          >
            New Session
          </button>
        )}
      </header>

      {/* Alert banner — top center */}
      {alert && (
        <div
          className="mx-4 mt-3 p-4 rounded-xl border-2 font-bold text-center text-base shrink-0 transition-all"
          style={{
            borderColor: SEVERITY_COLOR[alert.severity],
            backgroundColor: SEVERITY_COLOR[alert.severity] + "22",
            color: SEVERITY_COLOR[alert.severity],
          }}
        >
          {alert.message}
        </div>
      )}

      {/* Bottom-right toast stack — "Reported to city" */}
      <div className="fixed bottom-6 right-4 flex flex-col gap-2 z-50 pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="flex items-center gap-3 bg-slate-900/95 border rounded-xl px-4 py-3 shadow-2xl backdrop-blur"
            style={{ borderColor: SEVERITY_COLOR[t.severity] + "66" }}
          >
            <span className="text-lg">🏙️</span>
            <div className="flex flex-col">
              <span className="text-white text-xs font-bold">Reported to City of Sudbury</span>
              <span className="text-slate-400 text-xs">
                {t.severity} pothole · {Math.round(t.confidence * 100)}% confidence
              </span>
            </div>
            <div
              className="w-2 h-2 rounded-full ml-1 shrink-0"
              style={{ background: SEVERITY_COLOR[t.severity] }}
            />
          </div>
        ))}
      </div>

      <main className="flex flex-col flex-1 gap-4 p-4 overflow-hidden">
        {/* IDLE — upload prompt */}
        {phase === "idle" && (
          <div className="flex flex-col items-center justify-center flex-1 gap-6">
            <div className="text-center">
              <div className="text-6xl mb-4">🚗</div>
              <h1 className="text-2xl font-bold text-slate-100 mb-2">Start Dashcam Session</h1>
              <p className="text-slate-400 max-w-sm text-sm leading-relaxed">
                Upload a dashcam video and watch it stream live — potholes detected in real-time with map pins and driver alerts.
              </p>
            </div>

            <div
              className={`border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-colors w-full max-w-sm ${
                isDragging
                  ? "border-cyan-400 bg-cyan-900/20"
                  : "border-slate-600 hover:border-cyan-500/60 hover:bg-slate-800/40"
              }`}
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={onDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <div className="text-3xl mb-3">🎥</div>
              <p className="text-slate-300 font-medium mb-1">Drop video here</p>
              <p className="text-slate-500 text-xs">or click to browse · MP4, MOV, AVI</p>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="video/*"
              className="hidden"
              onChange={(e) => { if (e.target.files?.[0]) handleFile(e.target.files[0]) }}
            />
          </div>
        )}

        {/* UPLOADING */}
        {phase === "uploading" && (
          <div className="flex flex-col items-center justify-center flex-1 gap-4">
            <div className="text-4xl animate-spin">⚙️</div>
            <p className="text-slate-300 text-lg">Uploading video…</p>
          </div>
        )}

        {/* STREAMING / DONE */}
        {(phase === "streaming" || phase === "done") && jobId && (
          <div className="flex flex-col gap-3 flex-1 min-h-0">
            {/* Live dashcam feed */}
            <div className="relative rounded-2xl overflow-hidden border border-slate-700 bg-black shadow-xl shrink-0">
              {/* Status badge */}
              <div className="absolute top-3 left-3 z-10">
                {phase === "streaming" ? (
                  <span className="flex items-center gap-1.5 bg-red-600/90 backdrop-blur text-white text-xs font-bold px-3 py-1 rounded-full">
                    <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
                    LIVE
                  </span>
                ) : (
                  <span className="bg-slate-700/90 text-slate-200 text-xs font-bold px-3 py-1 rounded-full">
                    COMPLETE
                  </span>
                )}
              </div>

              {hazards.length > 0 && (
                <div className="absolute top-3 right-3 z-10 bg-red-600/90 backdrop-blur text-white text-xs font-bold px-3 py-1 rounded-full">
                  {hazards.length} pothole{hazards.length !== 1 ? "s" : ""} detected
                </div>
              )}

              {/* MJPEG stream — real-time annotated feed from backend */}
              <img
                src={`${API}/api/live/${jobId}`}
                alt="Live dashcam feed"
                className="w-full object-contain"
                style={{ minHeight: "200px", maxHeight: "42vh", background: "#000" }}
              />
            </div>

            {/* Progress bar */}
            {phase === "streaming" && (
              <div className="w-full bg-slate-800 rounded-full h-1.5 shrink-0">
                <div
                  className="bg-cyan-500 h-1.5 rounded-full transition-all duration-500"
                  style={{ width: `${progress}%` }}
                />
              </div>
            )}

            {/* Live map */}
            <div
              className="rounded-2xl overflow-hidden border border-slate-700 shrink-0"
              style={{ height: "220px" }}
            >
              <LiveMap hazards={hazards} carPos={carPos} />
            </div>

            {/* Detection list */}
            {hazards.length > 0 && (
              <div className="flex flex-col gap-2 min-h-0 flex-1">
                <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider shrink-0">
                  Detections ({hazards.length})
                </h2>
                <div className="flex flex-col gap-2 overflow-y-auto">
                  {[...hazards].reverse().map((h) => (
                    <div
                      key={h.id}
                      className="flex items-center gap-3 bg-slate-800/60 rounded-xl px-3 py-2.5 border border-slate-700/40"
                    >
                      <div
                        className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                        style={{ background: SEVERITY_COLOR[h.severity] }}
                      />
                      <span
                        className="text-xs font-bold w-14"
                        style={{ color: SEVERITY_COLOR[h.severity] }}
                      >
                        {h.severity}
                      </span>
                      <span className="text-slate-300 text-xs flex-1">
                        {Math.round(h.confidence * 100)}% conf
                      </span>
                      <span className="text-slate-500 text-xs">
                        {h.video_timestamp?.toFixed(1)}s
                      </span>
                      {h.frame_file && (
                        <img
                          src={`${API}/api/frames/${h.frame_file}`}
                          alt="frame"
                          className="w-14 h-9 object-cover rounded border border-slate-600 shrink-0"
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {phase === "done" && hazards.length === 0 && (
              <p className="text-center text-slate-500 py-4 text-sm">
                No potholes detected in this video.
              </p>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
