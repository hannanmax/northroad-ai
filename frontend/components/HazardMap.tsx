"use client"

import { useEffect, useRef } from "react"
import type { Hazard } from "@/lib/api"

const SEVERITY_COLOR: Record<string, string> = {
  HIGH: "#dc2626",
  MEDIUM: "#f59e0b",
  LOW: "#22c55e",
}

interface Props {
  hazards: Hazard[]
  selected: Hazard | null
  onSelect: (h: Hazard) => void
}

export default function HazardMap({ hazards, selected, onSelect }: Props) {
  const mapRef = useRef<any>(null)
  const markersRef = useRef<any[]>([])
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current) return

    let destroyed = false

    ;(async () => {
      const L = (await import("leaflet")).default

      // StrictMode mounts twice — bail if already cleaned up
      if (destroyed || mapRef.current) return

      // If the container div was already used by a previous Leaflet instance
      // (happens in StrictMode), destroy it first
      if ((containerRef.current as any)._leaflet_id) {
        ;(L as any).DomUtil.get(containerRef.current)._leaflet_id = undefined
      }

      delete (L.Icon.Default.prototype as any)._getIconUrl
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
        iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
        shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
      })

      const map = L.map(containerRef.current!, {
        center: [46.4917, -80.993],
        zoom: 14,
        zoomControl: true,
      })

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap contributors",
      }).addTo(map)

      mapRef.current = { map, L }
    })()

    return () => {
      destroyed = true
      if (mapRef.current) {
        mapRef.current.map.remove()
        mapRef.current = null
        markersRef.current = []
      }
    }
  }, [])

  useEffect(() => {
    if (!mapRef.current) return
    const { map, L } = mapRef.current

    // Clear old markers
    markersRef.current.forEach((m) => m.remove())
    markersRef.current = []

    hazards.forEach((h) => {
      const color = h.status === "resolved" ? "#64748b" : SEVERITY_COLOR[h.severity]
      const isSelected = selected?.id === h.id

      const marker = L.circleMarker([h.lat, h.lng], {
        radius: isSelected ? 14 : 10,
        fillColor: color,
        color: isSelected ? "#fff" : color,
        weight: isSelected ? 3 : 1.5,
        opacity: 1,
        fillOpacity: 0.85,
      }).addTo(map)

      marker.on("click", () => onSelect(h))

      markersRef.current.push(marker)
    })
  }, [hazards, selected, onSelect])

  // Pan to selected
  useEffect(() => {
    if (!mapRef.current || !selected) return
    const { map } = mapRef.current
    map.setView([selected.lat, selected.lng], 16, { animate: true })
  }, [selected])

  return (
    <div
      ref={containerRef}
      className="w-full h-full"
      style={{ minHeight: "400px" }}
    />
  )
}
