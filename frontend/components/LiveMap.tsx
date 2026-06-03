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
  carPos: [number, number] | null
}

export default function LiveMap({ hazards, carPos }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const stateRef = useRef<{ map: any; L: any; markers: any[]; carMarker: any } | null>(null)

  // Initialize map once
  useEffect(() => {
    if (!containerRef.current) return
    let destroyed = false

    ;(async () => {
      const L = (await import("leaflet")).default
      if (destroyed || stateRef.current) return

      if ((containerRef.current as any)._leaflet_id) {
        delete (containerRef.current as any)._leaflet_id
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
        attributionControl: false,
      })

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap contributors",
        maxZoom: 19,
      }).addTo(map)

      stateRef.current = { map, L, markers: [], carMarker: null }
    })()

    return () => {
      destroyed = true
      if (stateRef.current) {
        stateRef.current.map.remove()
        stateRef.current = null
      }
    }
  }, [])

  // Update hazard markers when new detections arrive
  useEffect(() => {
    const s = stateRef.current
    if (!s) return
    const { map, L, markers } = s

    // Only add NEW markers (last in list)
    const existingCount = markers.length
    const newHazards = hazards.slice(existingCount)

    newHazards.forEach((h) => {
      const color = SEVERITY_COLOR[h.severity] ?? "#64748b"
      const marker = L.circleMarker([h.lat, h.lng], {
        radius: 10,
        fillColor: color,
        color: "#fff",
        weight: 2,
        opacity: 1,
        fillOpacity: 0.9,
      })
        .addTo(map)
        .bindPopup(
          `<b>${h.severity}</b><br>${Math.round(h.confidence * 100)}% confidence`
        )

      markers.push(marker)
    })
  }, [hazards])

  // Update car marker position
  useEffect(() => {
    const s = stateRef.current
    if (!s || !carPos) return
    const { map, L } = s

    const carIcon = L.divIcon({
      html: `<div style="
        font-size:22px;
        line-height:1;
        filter: drop-shadow(0 2px 4px rgba(0,0,0,0.6));
        transform: translate(-50%, -50%);
      ">🚗</div>`,
      className: "",
      iconAnchor: [0, 0],
    })

    if (s.carMarker) {
      s.carMarker.setLatLng(carPos)
    } else {
      s.carMarker = L.marker(carPos, { icon: carIcon, zIndexOffset: 1000 }).addTo(map)
    }

    map.panTo(carPos, { animate: true, duration: 1.0 })
  }, [carPos])

  return (
    <div
      ref={containerRef}
      className="w-full h-full"
      style={{ minHeight: "200px", background: "#1a2e3d" }}
    />
  )
}
