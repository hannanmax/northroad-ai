"use client"

import { useEffect, useState } from "react"
import dynamic from "next/dynamic"
import { getHazards, getStats, resolveHazard, frameUrl, type Hazard, type Stats } from "@/lib/api"

const HazardMap = dynamic(() => import("@/components/HazardMap"), { ssr: false })

const SEVERITY_COLOR: Record<string, string> = {
  HIGH: "#dc2626",
  MEDIUM: "#f59e0b",
  LOW: "#22c55e",
}

export default function DashboardPage() {
  const [hazards, setHazards] = useState<Hazard[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [selected, setSelected] = useState<Hazard | null>(null)
  const [filter, setFilter] = useState<"all" | "open" | "resolved">("all")

  const load = async () => {
    const [h, s] = await Promise.all([getHazards(), getStats()])
    setHazards(h)
    setStats(s)
  }

  useEffect(() => {
    load()
    const interval = setInterval(load, 10000)
    return () => clearInterval(interval)
  }, [])

  const handleResolve = async (id: string) => {
    await resolveHazard(id)
    await load()
    setSelected(null)
  }

  const filtered = hazards.filter((h) => filter === "all" ? true : h.status === filter)

  return (
    <div className="flex h-[calc(100vh-56px)]">
      {/* Sidebar */}
      <div className="w-80 flex-shrink-0 border-r border-slate-700 bg-slate-900 flex flex-col overflow-hidden">
        {/* Stats */}
        <div className="p-4 border-b border-slate-700">
          <h2 className="text-white font-bold mb-3">Sudbury Road Intelligence</h2>
          {stats ? (
            <div className="grid grid-cols-3 gap-2 mb-3">
              {(["HIGH", "MEDIUM", "LOW"] as const).map((s) => (
                <div
                  key={s}
                  className="rounded-lg p-2 text-center border"
                  style={{ borderColor: SEVERITY_COLOR[s] + "55", background: SEVERITY_COLOR[s] + "15" }}
                >
                  <div className="text-lg font-bold" style={{ color: SEVERITY_COLOR[s] }}>
                    {s === "HIGH" ? stats.high : s === "MEDIUM" ? stats.medium : stats.low}
                  </div>
                  <div className="text-slate-500 text-xs">{s}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-slate-500 text-sm">Loading...</div>
          )}
          {stats && (
            <div className="flex justify-between text-xs text-slate-400 border-t border-slate-700 pt-2 mt-1">
              <span>{stats.total} total hazards</span>
              <span>{stats.open} open · {stats.resolved} resolved</span>
            </div>
          )}
        </div>

        {/* Filter */}
        <div className="flex border-b border-slate-700">
          {(["all", "open", "resolved"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`flex-1 py-2 text-xs font-medium capitalize transition-colors ${
                filter === f ? "text-white border-b-2 border-blue-400" : "text-slate-500 hover:text-slate-300"
              }`}
            >
              {f}
            </button>
          ))}
        </div>

        {/* Hazard list */}
        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="text-slate-500 text-sm text-center py-12 px-4">
              No hazards yet.<br />Upload a dashcam video to get started.
            </div>
          ) : (
            filtered.map((h) => (
              <button
                key={h.id}
                onClick={() => setSelected(h)}
                className={`w-full flex items-center gap-3 px-4 py-3 border-b border-slate-800 text-left transition-colors hover:bg-slate-800 ${
                  selected?.id === h.id ? "bg-slate-800" : ""
                }`}
              >
                <div
                  className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                  style={{ background: SEVERITY_COLOR[h.severity] }}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-white text-xs font-medium truncate">
                    {h.severity} severity
                    {h.status === "resolved" && <span className="ml-2 text-slate-500">(resolved)</span>}
                  </div>
                  <div className="text-slate-500 text-xs truncate">
                    {h.lat.toFixed(4)}, {h.lng.toFixed(4)}
                  </div>
                </div>
                <div className="text-slate-600 text-xs">{(h.confidence * 100).toFixed(0)}%</div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Map area */}
      <div className="flex-1 relative">
        <HazardMap
          hazards={filtered}
          selected={selected}
          onSelect={setSelected}
        />

        {/* Detail panel */}
        {selected && (
          <div className="absolute bottom-4 right-4 w-72 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl overflow-hidden z-[1000]">
            <img
              src={frameUrl(selected.frame_file)}
              alt="Detection frame"
              className="w-full h-40 object-cover"
            />
            <div className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <span
                  className="text-xs font-bold px-2 py-1 rounded"
                  style={{ background: SEVERITY_COLOR[selected.severity] + "33", color: SEVERITY_COLOR[selected.severity] }}
                >
                  {selected.severity}
                </span>
                <span className="text-slate-400 text-xs">{(selected.confidence * 100).toFixed(0)}% confidence</span>
              </div>
              <p className="text-slate-400 text-xs mb-1">
                📍 {selected.lat.toFixed(5)}, {selected.lng.toFixed(5)}
              </p>
              <p className="text-slate-500 text-xs mb-3">Status: {selected.status}</p>
              <div className="flex gap-2">
                {selected.status !== "resolved" && (
                  <button
                    onClick={() => handleResolve(selected.id)}
                    className="flex-1 py-2 bg-green-700 hover:bg-green-600 text-white text-xs rounded-lg font-semibold transition-colors"
                  >
                    ✓ Mark Repaired
                  </button>
                )}
                <button
                  onClick={() => setSelected(null)}
                  className="px-3 py-2 bg-slate-700 hover:bg-slate-600 text-white text-xs rounded-lg transition-colors"
                >
                  ✕
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
