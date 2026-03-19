import { useEffect, useRef, useCallback } from 'react'
import type { Camera } from '../types'
import { useFrameStore } from '../store'

const STATUS_COLOR: Record<string, string> = {
  compliant: '#22c55e',
  partial: '#f59e0b',
  non_compliant: '#ef4444',
}

interface Props {
  camera: Camera
  selected: boolean
  onClick: () => void
  onDoubleClick: () => void
}

export default function CameraTile({ camera, selected, onClick, onDoubleClick }: Props) {
  const frame = useFrameStore((s) => s.frames[camera.id] ?? null)
  const connected = frame !== null
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef<number | null>(null)
  // pending holds pre-decoded bitmap + detection data ready to paint
  const pendingRef = useRef<{ bmp: ImageBitmap; frame: typeof frame } | null>(null)

  const scheduleRender = useCallback(() => {
    if (rafRef.current !== null) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      const pending = pendingRef.current
      const canvas = canvasRef.current
      if (!pending || !canvas) return

      const { bmp, frame: f } = pending
      pendingRef.current = null
      const ctx = canvas.getContext('2d')!

      if (canvas.width !== bmp.width || canvas.height !== bmp.height) {
        canvas.width = bmp.width
        canvas.height = bmp.height
      }
      ctx.drawImage(bmp, 0, 0)
      bmp.close()

      for (const det of f!.detections) {
        const [x1, y1, x2, y2] = det.bbox
        const color = STATUS_COLOR[det.status] ?? '#9ca3af'
        ctx.strokeStyle = color
        ctx.lineWidth = 2
        ctx.strokeRect(x1, y1, x2 - x1, y2 - y1)

        const label = `#${det.track_id} H:${det.helmet ? 'Y' : 'N'} V:${det.vest ? 'Y' : 'N'}`
        ctx.font = 'bold 13px monospace'
        const tw = ctx.measureText(label).width
        ctx.fillStyle = color
        ctx.fillRect(x1, y1 - 18, tw + 8, 18)
        ctx.fillStyle = '#000'
        ctx.fillText(label, x1 + 4, y1 - 4)
      }
    })
  }, [])

  useEffect(() => {
    if (!frame) return
    // Decode base64 → Blob → ImageBitmap off main thread, then schedule paint
    const byteStr = atob(frame.jpeg_b64)
    const bytes = new Uint8Array(byteStr.length)
    for (let i = 0; i < byteStr.length; i++) bytes[i] = byteStr.charCodeAt(i)
    const blob = new Blob([bytes], { type: 'image/jpeg' })
    createImageBitmap(blob).then((bmp) => {
      pendingRef.current = { bmp, frame }
      scheduleRender()
    })
  }, [frame, scheduleRender])

  // Cancel any pending RAF on unmount
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  const summary = frame?.summary ?? camera.current_summary
  const hasViolation = summary.non_compliant > 0
  const hasPartial = summary.partial > 0

  const borderColor = selected
    ? 'border-blue-400'
    : hasViolation
    ? 'border-red-600'
    : hasPartial
    ? 'border-yellow-500'
    : 'border-gray-800'

  return (
    <div
      className={`relative bg-black border-2 ${borderColor} cursor-pointer overflow-hidden group w-full h-full`}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
    >
      {/* Video */}
      {frame ? (
        <canvas ref={canvasRef} className="w-full h-full object-contain block" />
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
          <span className="text-gray-600 text-2xl">📷</span>
          <span className="text-gray-600 text-xs">
            {camera.status === 'online' ? '연결 중...' : '오프라인'}
          </span>
        </div>
      )}

      {/* Top-right: LIVE + compliance */}
      <div className="absolute top-1.5 right-1.5 flex items-center gap-1">
        {summary.non_compliant > 0 && (
          <span className="bg-red-700 text-white text-xs px-1.5 py-0.5 rounded font-bold animate-pulse">
            위반 {summary.non_compliant}
          </span>
        )}
        {connected && (
          <span className="bg-red-700/80 text-white text-xs px-1.5 py-0.5 rounded font-bold">LIVE</span>
        )}
      </div>

      {/* Bottom overlay: camera name + stats */}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent px-2 py-1.5">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-white text-xs font-semibold">{camera.name}</span>
            {camera.zone && <span className="text-gray-400 text-xs ml-1.5">{camera.zone}</span>}
          </div>
          <div className="flex items-center gap-1.5 text-xs">
            {summary.total_persons > 0 && (
              <>
                <span className="text-green-400">{summary.compliant}✓</span>
                {summary.partial > 0 && <span className="text-yellow-400">{summary.partial}△</span>}
                {summary.non_compliant > 0 && <span className="text-red-400">{summary.non_compliant}✗</span>}
              </>
            )}
            {summary.total_persons === 0 && <span className="text-gray-600">감지 없음</span>}
          </div>
        </div>
      </div>

      {/* Selected highlight */}
      {selected && (
        <div className="absolute inset-0 border-2 border-blue-400 pointer-events-none" />
      )}

      {/* Double-click hint on hover */}
      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
        <span className="text-white/40 text-xs">더블클릭: 전체화면</span>
      </div>
    </div>
  )
}
