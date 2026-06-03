import Link from "next/link"

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 text-center">
      <div className="mb-6 text-6xl">⬡</div>
      <h1 className="text-5xl font-bold text-white mb-4">NorthRoad AI</h1>
      <p className="text-xl text-slate-400 max-w-xl mb-2">
        AI-Powered Road Hazard Detection for Northern Ontario
      </p>
      <p className="text-slate-500 max-w-lg mb-10 text-sm">
        Every vehicle becomes a mobile road inspector. Upload dashcam footage, detect potholes with YOLOv8,
        and give municipalities a live repair dashboard — all self-hosted.
      </p>

      <div className="flex gap-4 flex-wrap justify-center">
        <Link
          href="/driver"
          className="px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-semibold transition-colors"
        >
          Upload Dashcam Video
        </Link>
        <Link
          href="/dashboard"
          className="px-6 py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-semibold transition-colors"
        >
          Municipal Dashboard
        </Link>
      </div>

      <div className="mt-16 grid grid-cols-1 sm:grid-cols-3 gap-6 max-w-3xl w-full text-left">
        {[
          { icon: "🎯", title: "YOLOv8 Detection", desc: "Real-time AI detects potholes in dashcam footage automatically" },
          { icon: "🗺️", title: "Live Hazard Map", desc: "Detected hazards appear instantly on an OpenStreetMap dashboard" },
          { icon: "🏛️", title: "Self-Hosted", desc: "Municipalities own all data. No cloud. No subscriptions. No lock-in." },
        ].map((f) => (
          <div key={f.title} className="bg-slate-800/60 rounded-xl p-5 border border-slate-700">
            <div className="text-2xl mb-2">{f.icon}</div>
            <div className="font-semibold text-white mb-1">{f.title}</div>
            <div className="text-sm text-slate-400">{f.desc}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
