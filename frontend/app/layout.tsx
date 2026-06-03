import type { Metadata } from "next"
import "./globals.css"
import Link from "next/link"

export const metadata: Metadata = {
  title: "NorthRoad AI",
  description: "AI-Powered Road Hazard Detection for Northern Ontario",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <nav className="border-b border-slate-700 bg-slate-900/80 backdrop-blur sticky top-0 z-50">
          <div className="max-w-7xl mx-auto px-4 flex items-center h-14 gap-8">
            <Link href="/" className="flex items-center gap-2 font-bold text-lg text-white">
              <span className="text-blue-400">⬡</span>
              NorthRoad AI
            </Link>
            <div className="flex gap-6 ml-4">
              <Link href="/driver" className="text-slate-300 hover:text-white text-sm font-medium transition-colors">
                Driver View
              </Link>
              <Link href="/dashboard" className="text-slate-300 hover:text-white text-sm font-medium transition-colors">
                Municipal Dashboard
              </Link>
            </div>
          </div>
        </nav>
        <main>{children}</main>
      </body>
    </html>
  )
}
