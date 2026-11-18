// Pembuatan QR (SVG) dan pemindai kamera. Library dimuat saat dibutuhkan saja.
import { useCallback, useEffect, useRef, useState } from 'react'

const svgCache = new Map<string, string>()
export async function qrSvg(text: string): Promise<string> {
  const hit = svgCache.get(text)
  if (hit) return hit
  const QR = (await import('qrcode')).default
  const svg = await QR.toString(text, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' })
  svgCache.set(text, svg)
  return svg
}

export function useQrSvg(text: string | null) {
  const [svg, setSvg] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    if (text) qrSvg(text).then((s) => alive && setSvg(s))
    return () => {
      alive = false
    }
  }, [text])
  return svg
}

/** Bunyi "bip" singkat + getar sebagai tanda scan berhasil. */
export function beep(ok = true) {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const ctx = new Ctx()
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.frequency.value = ok ? 1200 : 300
    g.gain.value = 0.08
    o.connect(g)
    g.connect(ctx.destination)
    o.start()
    o.stop(ctx.currentTime + (ok ? 0.08 : 0.25))
    setTimeout(() => ctx.close(), 400)
  } catch {
    /* tanpa suara */
  }
  if (navigator.vibrate) navigator.vibrate(ok ? 60 : [80, 60, 80])
}

type Detector = { detect: (src: CanvasImageSource) => Promise<{ rawValue: string }[]> }

/**
 * Pemindai QR lewat kamera belakang. Memakai BarcodeDetector bawaan browser bila ada (Chrome Android),
 * selain itu jsQR. Setelah satu QR terbaca, jeda `pauseMs` supaya satu barang tidak terhitung dua kali.
 */
export function useQrScanner(onScan: (text: string) => void, pauseMs = 1200) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [active, setActive] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const timer = useRef<number | null>(null)
  const pausedUntil = useRef(0)
  const cb = useRef(onScan)
  cb.current = onScan

  const stop = useCallback(() => {
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = null
    stream.current?.getTracks().forEach((t) => t.stop())
    stream.current = null
    setActive(false)
  }, [])

  const start = useCallback(async () => {
    setError(null)
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Browser ini tidak bisa membuka kamera. Pakai Chrome/Safari terbaru, atau tambahkan barang manual.')
      return
    }
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
    } catch {
      setError('Izin kamera ditolak. Izinkan kamera untuk situs ini di pengaturan browser, lalu coba lagi.')
      return
    }
    const video = videoRef.current
    if (!video) return
    video.srcObject = stream.current
    video.setAttribute('playsinline', 'true')
    await video.play().catch(() => {})
    setActive(true)
    let detector: Detector | null = null
    const BD = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector
    if (BD) {
      try {
        detector = new BD({ formats: ['qr_code'] })
      } catch {
        detector = null
      }
    }
    const jsQR = detector ? null : (await import('jsqr')).default
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    const tick = async () => {
      if (!stream.current) return
      if (Date.now() >= pausedUntil.current && video.readyState >= 2) {
        let text: string | null = null
        try {
          if (detector) {
            const r = await detector.detect(video)
            text = r[0]?.rawValue ?? null
          } else if (jsQR && ctx) {
            const w = Math.min(640, video.videoWidth)
            const h = Math.round((video.videoHeight / video.videoWidth) * w)
            canvas.width = w
            canvas.height = h
            ctx.drawImage(video, 0, 0, w, h)
            const img = ctx.getImageData(0, 0, w, h)
            text = jsQR(img.data, w, h, { inversionAttempts: 'dontInvert' })?.data ?? null
          }
        } catch {
          text = null
        }
        if (text) {
          pausedUntil.current = Date.now() + pauseMs
          cb.current(text)
        }
      }
      timer.current = window.setTimeout(tick, 180)
    }
    tick()
  }, [pauseMs])

  useEffect(() => stop, [stop])
  return { videoRef, active, error, start, stop }
}

export interface LabelItem {
  sku: string
  title: string
  color: string
  price: number | null
  copies: number
}

/** Membuka jendela cetak berisi label QR. size: thermal 50×30 mm per lembar, atau A4 berisi 4 × 10 label. */
export async function printLabels(items: LabelItem[], size: 'thermal' | 'a4', origin: string) {
  const win = window.open('', '_blank')
  if (!win) throw new Error('Jendela cetak diblokir browser. Izinkan pop-up untuk portal ini.')
  win.document.write('<p style="font-family:sans-serif;padding:16px">Menyiapkan label…</p>')
  const svgs = new Map<string, string>()
  for (const it of items) if (!svgs.has(it.sku)) svgs.set(it.sku, await qrSvg(`${origin}/qr/${encodeURIComponent(it.sku)}`))
  const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!)
  // label hanya berisi kode SKU dan warna (tanpa harga)
  const one = (it: LabelItem) => `<div class="lb"><div class="qr">${svgs.get(it.sku)}</div><div class="tx"><div class="sku">${esc(it.sku)}</div><div class="cl">${esc(it.color)}</div></div></div>`
  const labels = items.flatMap((it) => Array.from({ length: Math.max(0, it.copies) }, () => one(it))).join('')
  const css =
    size === 'thermal'
      ? `@page{size:50mm 30mm;margin:0}body{margin:0}.lb{width:50mm;height:30mm;padding:2mm;box-sizing:border-box;page-break-after:always;display:flex;gap:2mm;align-items:center}.qr{width:24mm;height:24mm;flex:none}`
      : `@page{size:A4;margin:10mm 8mm}body{margin:0}.sheet{display:grid;grid-template-columns:repeat(4,1fr);grid-auto-rows:27.7mm}.lb{padding:1.5mm 2mm;box-sizing:border-box;display:flex;gap:2mm;align-items:center;border:0.2mm dashed #ccc;break-inside:avoid}.qr{width:22mm;height:22mm;flex:none}`
  win.document.open()
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Label QR Glamora88</title><style>
${css}
*{-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{font-family:Arial,Helvetica,sans-serif;color:#000}
.qr svg{width:100%;height:100%;display:block}
.tx{min-width:0;line-height:1.15}
.sku{font-size:8pt;font-weight:700;word-break:break-all}
.cl{font-size:8.5pt;margin-top:1.2mm;word-break:break-word}
@media screen{body{background:#eee;padding:12px}.lb{background:#fff;margin:0 auto 6px}.sheet{background:#fff;width:194mm;margin:0 auto}}
</style></head><body>${size === 'a4' ? `<div class="sheet">${labels}</div>` : labels}
<script>window.onload=function(){setTimeout(function(){window.print()},300)}</script></body></html>`)
  win.document.close()
}
