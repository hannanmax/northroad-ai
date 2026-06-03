const BASE = "http://localhost:8000"

export interface Hazard {
  id: string
  job_id: string
  lat: number
  lng: number
  severity: "LOW" | "MEDIUM" | "HIGH"
  confidence: number
  frame_file: string
  video_timestamp: number
  status: string
}

export interface Job {
  id: string
  status: string
  progress: number
}

export interface Stats {
  total: number
  high: number
  medium: number
  low: number
  open: number
  resolved: number
}

export async function uploadVideo(file: File): Promise<{ job_id: string }> {
  const fd = new FormData()
  fd.append("file", file)
  const res = await fetch(`${BASE}/api/upload`, { method: "POST", body: fd })
  if (!res.ok) throw new Error("Upload failed")
  return res.json()
}

export async function getJob(jobId: string): Promise<Job> {
  const res = await fetch(`${BASE}/api/jobs/${jobId}`)
  return res.json()
}

export async function getHazards(): Promise<Hazard[]> {
  const res = await fetch(`${BASE}/api/hazards`)
  return res.json()
}

export async function getStats(): Promise<Stats> {
  const res = await fetch(`${BASE}/api/stats`)
  return res.json()
}

export async function resolveHazard(id: string): Promise<void> {
  await fetch(`${BASE}/api/hazards/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "resolved" }),
  })
}

export function frameUrl(filename: string): string {
  return `${BASE}/api/frames/${filename}`
}
