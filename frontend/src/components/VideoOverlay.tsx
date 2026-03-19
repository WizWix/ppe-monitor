import { useEffect, useRef } from 'react'
import type { CameraFrame } from '../types'

const STATUS_COLOR: Record<string, string> = {
  compliant: '#22c55e',
  partial: '#f59e0b',
  non_compliant: '#ef4444',
}

interface Props {
  frame: CameraFrame | null
  className?: string
}

export default function VideoOverlay({ frame, className }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imgRef = useRef<HTMLImageElement>(new Image())

  useEffect(() => {
    if (!frame || !canvasRef.current) return
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')!
    const img = imgRef.current

    img.onload = () => {
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      ctx.drawImage(img, 0, 0)

      // Draw detection boxes
      for (const det of frame.detections) {
        const [x1, y1, x2, y2] = det.bbox
        const color = STATUS_COLOR[det.status] ?? '#9ca3af'

        ctx.strokeStyle = color
        ctx.lineWidth = 2
        ctx.strokeRect(x1, y1, x2 - x1, y2 - y1)

        // Label background
        const label = `#${det.track_id} H:${det.helmet ? 'Y' : 'N'} V:${det.vest ? 'Y' : 'N'} ${Math.round(det.confidence * 100)}%`
        ctx.font = 'bold 13px monospace'
        const tw = ctx.measureText(label).width
        ctx.fillStyle = color
        ctx.fillRect(x1, y1 - 18, tw + 8, 18)
        ctx.fillStyle = '#000'
        ctx.fillText(label, x1 + 4, y1 - 4)
      }
    }
    img.src = 'data:image/jpeg;base64,' + frame.jpeg_b64
  }, [frame])

  return (
    <canvas
      ref={canvasRef}
      className={className ?? 'w-full h-full object-contain'}
      style={{ background: '#111' }}
    />
  )
}
