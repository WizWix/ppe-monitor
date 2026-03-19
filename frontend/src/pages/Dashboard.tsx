import React, { useEffect, useState, useCallback, useRef } from 'react'
import { format } from 'date-fns'
import { useNavigate } from 'react-router-dom'
import { camerasApi, statsApi } from '../api/client'
import { useCameraStore, useAlertStore, useFrameStore, toViolationType, useSettingsStore, speakViolation } from '../store'
import { useLayoutStore, collectCameraIds, makeLeaf, makeSplit } from '../store/layout'
import type { PanelNode } from '../store/layout'

import type { Camera, CameraFrame, StatsSummary } from '../types'
import { PanelTreeRoot } from '../components/PanelTree'

// ── Global stream manager ─────────────────────────────────────────────────────
const activeStreams = new Map<string, WebSocket>()

function useGlobalStreams(cameras: Camera[]) {
  const { pushAlert } = useAlertStore()
  const { setFrame, clearFrame } = useFrameStore()
  const { ttsEnabled } = useSettingsStore()
  const root = useLayoutStore((s) => s.root)
  const lastViolation = useRef(new Map<string, number>())
  const lastFrameTime = useRef(new Map<string, number>())
  const FRAME_INTERVAL = 100

  // Only stream cameras that are actually placed in the layout
  const layoutIds = new Set(collectCameraIds(root))
  const streamCameras = cameras.filter((c) => layoutIds.has(c.id))

  useEffect(() => {
    // Close streams for cameras no longer in layout
    for (const [id, ws] of activeStreams) {
      if (!streamCameras.find((c) => c.id === id)) {
        ws.close()
        activeStreams.delete(id)
        clearFrame(id)
      }
    }

    streamCameras.forEach((cam) => {
      if (cam.status !== 'online' || activeStreams.has(cam.id)) return

      const proto = location.protocol === 'https:' ? 'wss' : 'ws'
      const ws = new WebSocket(`${proto}://${location.host}/ws/cameras/${cam.id}/stream`)
      activeStreams.set(cam.id, ws)

      ws.onmessage = (evt) => {
        try {
          const frame = JSON.parse(evt.data) as CameraFrame
          if (!frame.detections) return

          const now = Date.now()
          const last = lastFrameTime.current.get(cam.id) ?? 0
          if (now - last >= FRAME_INTERVAL) {
            lastFrameTime.current.set(cam.id, now)
            setFrame(cam.id, frame)
          }

          for (const det of frame.detections) {
            if (det.status === 'compliant') continue
            const key = `${cam.id}-${det.track_id}`
            if ((now - (lastViolation.current.get(key) ?? 0)) < 30_000) continue
            lastViolation.current.set(key, now)
            const vtype = toViolationType(det.helmet, det.vest)
            pushAlert({
              camera_id: cam.id, camera_name: cam.name,
              track_id: det.track_id, type: vtype,
              timestamp: frame.timestamp,
            })
            if (ttsEnabled) speakViolation(vtype, cam.name)
          }
        } catch {}
      }

      const cleanup = () => { activeStreams.delete(cam.id); clearFrame(cam.id) }
      ws.onclose = cleanup
      ws.onerror = cleanup
    })
  }, [streamCameras, pushAlert, setFrame, clearFrame])
}

// ── Floating alert panel ──────────────────────────────────────────────────────
function FloatingAlerts({ onClose }: { onClose: () => void }) {
  const { alerts, acknowledge, clear } = useAlertStore()
  const navigate = useNavigate()
  const unread = alerts.filter((a) => !a.acknowledged)
  const TYPE_LABEL: Record<string, string> = {
    no_helmet: '헬멧 미착용', no_vest: '조끼 미착용', no_helmet_no_vest: '헬멧+조끼 미착용',
  }
  return (
    <div className="absolute top-10 right-2 w-72 bg-gray-900 border border-gray-600 rounded shadow-2xl z-50 flex flex-col max-h-96">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700">
        <span className="text-sm font-semibold text-gray-200">알림 피드</span>
        <div className="flex gap-2">
          {alerts.length > 0 && <button className="text-xs text-gray-500 hover:text-gray-300" onClick={clear}>지우기</button>}
          <button className="text-gray-400 hover:text-gray-200 text-sm" onClick={onClose}>✕</button>
        </div>
      </div>
      <div className="overflow-y-auto flex-1">
        {unread.length === 0 && <div className="text-center text-gray-600 text-xs py-6">미확인 알림 없음</div>}
        {unread.map((a) => (
          <div key={a.id} className="px-3 py-2 border-b border-gray-800">
            <div className="text-xs text-gray-500">{format(new Date(a.timestamp), 'HH:mm:ss')} · {a.camera_name}</div>
            <div className="text-sm text-red-300 font-semibold mt-0.5">작업자 #{a.track_id} — {TYPE_LABEL[a.type]}</div>
            <div className="flex gap-2 mt-1">
              <button className="text-xs text-blue-400" onClick={() => navigate(`/cameras/${a.camera_id}`)}>보기</button>
              <button className="text-xs text-gray-400" onClick={() => acknowledge(a.id)}>확인</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Preset buttons ────────────────────────────────────────────────────────────
const PRESETS = [
  { label: '1×1', cols: 1, rows: 1 },
  { label: '2×2', cols: 2, rows: 2 },
  { label: '3×3', cols: 3, rows: 3 },
  { label: '4×4', cols: 4, rows: 4 },
]

// ── Named (editorial) layout presets ─────────────────────────────────────────
type NamedPreset = { id: string; title: string; build: (ids: string[]) => PanelNode; icon: React.ReactNode }

const G = 1.5  // gap px in SVG
const S = ({ x, y, w, h, dim = false }: { x: number; y: number; w: number; h: number; dim?: boolean }) => (
  <rect x={x} y={y} width={w} height={h} rx="1" fill="currentColor" opacity={dim ? 0.4 : 0.72} />
)

const NAMED_PRESETS: NamedPreset[] = [
  {
    id: 'focus-right',
    title: '주화면 + 우측 3분할',
    build: (ids) => {
      let i = 0; const n = () => ids[i++] ?? null
      return makeSplit('horizontal', [
        makeLeaf(n()),
        makeSplit('vertical', [makeLeaf(n()), makeLeaf(n()), makeLeaf(n())]),
      ], [72, 28])
    },
    icon: (
      <svg viewBox="0 0 36 24" width="36" height="24">
        <S x={0}    y={0}    w={23}   h={24} />
        <S x={24.5} y={0}    w={11.5} h={7}   dim />
        <S x={24.5} y={8.5}  w={11.5} h={7}   dim />
        <S x={24.5} y={17}   w={11.5} h={7}   dim />
      </svg>
    ),
  },
  {
    id: 'focus-bottom',
    title: '주화면 + 하단 3분할',
    build: (ids) => {
      let i = 0; const n = () => ids[i++] ?? null
      return makeSplit('vertical', [
        makeLeaf(n()),
        makeSplit('horizontal', [makeLeaf(n()), makeLeaf(n()), makeLeaf(n())]),
      ], [68, 32])
    },
    icon: (
      <svg viewBox="0 0 36 24" width="36" height="24">
        <S x={0}           y={0}    w={36}  h={15} />
        <S x={0}           y={16.5} w={10.5} h={7.5} dim />
        <S x={10.5 + G}    y={16.5} w={10.5} h={7.5} dim />
        <S x={21 + G * 2}  y={16.5} w={10.5} h={7.5} dim />
      </svg>
    ),
  },
  {
    id: 'featured',
    title: '주화면 + 우측 3 + 하단 4',
    build: (ids) => {
      let i = 0; const n = () => ids[i++] ?? null
      return makeSplit('vertical', [
        makeSplit('horizontal', [
          makeLeaf(n()),
          makeSplit('vertical', [makeLeaf(n()), makeLeaf(n()), makeLeaf(n())]),
        ], [72, 28]),
        makeSplit('horizontal', [makeLeaf(n()), makeLeaf(n()), makeLeaf(n()), makeLeaf(n())]),
      ], [72, 28])
    },
    icon: (
      <svg viewBox="0 0 36 24" width="36" height="24">
        <S x={0}    y={0}    w={23}   h={15} />
        <S x={24.5} y={0}    w={11.5} h={4.5} dim />
        <S x={24.5} y={6}    w={11.5} h={4.5} dim />
        <S x={24.5} y={12}   w={11.5} h={3}   dim />
        <S x={0}           y={16.5} w={7.5} h={7.5} dim />
        <S x={7.5  + G}    y={16.5} w={7.5} h={7.5} dim />
        <S x={15   + G*2}  y={16.5} w={7.5} h={7.5} dim />
        <S x={22.5 + G*3}  y={16.5} w={7.5} h={7.5} dim />
      </svg>
    ),
  },
  {
    id: 'split-2-4',
    title: '상단 2분할 + 하단 4분할',
    build: (ids) => {
      let i = 0; const n = () => ids[i++] ?? null
      return makeSplit('vertical', [
        makeSplit('horizontal', [makeLeaf(n()), makeLeaf(n())]),
        makeSplit('horizontal', [makeLeaf(n()), makeLeaf(n()), makeLeaf(n()), makeLeaf(n())]),
      ], [52, 48])
    },
    icon: (
      <svg viewBox="0 0 36 24" width="36" height="24">
        <S x={0}      y={0}    w={17} h={11.5} dim />
        <S x={17 + G} y={0}    w={17} h={11.5} dim />
        <S x={0}           y={13}  w={7.5} h={11} dim />
        <S x={7.5  + G}    y={13}  w={7.5} h={11} dim />
        <S x={15   + G*2}  y={13}  w={7.5} h={11} dim />
        <S x={22.5 + G*3}  y={13}  w={7.5} h={11} dim />
      </svg>
    ),
  },
]

// ── Main Dashboard ────────────────────────────────────────────────────────────
export default function Dashboard() {
  const { cameras, setCameras } = useCameraStore()
  const { alerts } = useAlertStore()
  const { root, applyPreset, applyLayout } = useLayoutStore()
  const [summary, setSummary] = useState<StatsSummary | null>(null)
  const [showAlerts, setShowAlerts] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [now, setNow] = useState(new Date())
  const unread = alerts.filter((a) => !a.acknowledged).length

  const load = useCallback(async () => {
    try {
      const [cams, stats] = await Promise.all([camerasApi.list(), statsApi.summary()])
      setCameras(cams)
      setSummary(stats)
    } catch {}
  }, [setCameras])

  useEffect(() => {
    load()
    const iv = setInterval(load, 10_000)
    const cl = setInterval(() => setNow(new Date()), 1000)
    return () => { clearInterval(iv); clearInterval(cl) }
  }, [load])

  useGlobalStreams(cameras)

  const pct = summary ? Math.round(summary.compliance_rate * 100) : null
  const pctColor = pct == null ? 'text-gray-400' : pct >= 90 ? 'text-green-400' : pct >= 70 ? 'text-yellow-400' : 'text-red-400'

  return (
    <div className="flex flex-col h-full bg-black">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-3 h-9 border-b border-gray-800 flex-shrink-0 bg-gray-950">
        {/* Grid presets */}
        <div className="flex gap-0.5">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              onClick={() => applyPreset(p.cols, p.rows, cameras.map((c) => c.id))}
              className="px-2 py-0.5 text-xs rounded text-gray-400 hover:bg-gray-800 transition-colors"
              title={`${p.label} 프리셋 적용`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="w-px h-4 bg-gray-700" />
        {/* Named layout presets */}
        <div className="flex gap-0.5">
          {NAMED_PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => applyLayout(p.build(cameras.map((c) => c.id)))}
              className="p-1 rounded text-gray-500 hover:text-gray-200 hover:bg-gray-800 transition-colors"
              title={p.title}
            >
              {p.icon}
            </button>
          ))}
        </div>
        <div className="w-px h-4 bg-gray-700" />
        {summary && (
          <div className="flex items-center gap-4 text-xs">
            <span className={`font-bold ${pctColor}`}>준수율 {pct}%</span>
            <span className="text-gray-500">인원 {summary.total_persons_today}명</span>
            <span className="text-gray-500">카메라 {summary.cameras_online}/{summary.cameras_total}</span>
            {summary.active_violations > 0 && (
              <span className="text-red-400 font-bold animate-pulse">⚠ 위반 {summary.active_violations}건</span>
            )}
          </div>
        )}
        <div className="flex-1" />
        <span className="text-xs text-gray-500 font-mono">{format(now, 'HH:mm:ss')}</span>
        <button
          onClick={() => setShowHelp(true)}
          className="text-xs text-gray-500 hover:text-gray-300 hover:bg-gray-800 w-5 h-5 rounded-full border border-gray-700 flex items-center justify-center flex-shrink-0"
          title="사용법"
        >
          ?
        </button>
        <div className="relative">
          <button
            onClick={() => setShowAlerts((v) => !v)}
            className={`text-sm px-2 py-0.5 rounded ${unread > 0 ? 'text-red-400 hover:bg-red-900/30' : 'text-gray-500 hover:bg-gray-800'}`}
          >
            🔔{unread > 0 && <span className="ml-1 font-bold">{unread}</span>}
          </button>
          {showAlerts && <FloatingAlerts onClose={() => setShowAlerts(false)} />}
        </div>
      </div>

      {/* Panel tree */}
      <div className="flex-1 overflow-hidden">
        <PanelTreeRoot node={root} />
      </div>

      {/* Help modal */}
      {showHelp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => setShowHelp(false)}>
          <div className="bg-gray-950 border border-gray-700 rounded-xl shadow-2xl w-96 overflow-hidden" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
              <div className="flex items-center gap-2">
                <span className="text-base font-bold text-white">대시보드 사용법</span>
              </div>
              <button className="text-gray-600 hover:text-gray-300 transition-colors text-lg leading-none" onClick={() => setShowHelp(false)}>✕</button>
            </div>

            <div className="p-5 space-y-5">
              {/* Section */}
              {[
                {
                  icon: '⊞',
                  title: '레이아웃',
                  rows: [
                    ['1×1 ~ 4×4 버튼', '균등 프리셋으로 초기화'],
                    ['경계 드래그', '패널 크기 자유 조절'],
                    ['경계를 끝까지 밀기', '해당 패널 제거, 인접 패널이 공간 흡수'],
                  ],
                },
                {
                  icon: '🖱',
                  title: '패널 우클릭',
                  rows: [
                    ['↑↓←→ 방향', '해당 방향에 새 패널 추가'],
                    ['카메라 지정 / 변경', '패널에 카메라 연결'],
                    ['패널 닫기', '제거 후 공간을 인접 패널에 분배'],
                  ],
                },
                {
                  icon: '📷',
                  title: '카메라',
                  rows: [
                    ['빈 슬롯 클릭', '카메라 바로 지정'],
                    ['더블클릭', '카메라 전체화면'],
                  ],
                },
              ].map((section) => (
                <div key={section.title}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-base leading-none">{section.icon}</span>
                    <span className="text-xs font-bold text-gray-300 uppercase tracking-wider">{section.title}</span>
                  </div>
                  <div className="rounded-lg overflow-hidden border border-gray-800">
                    {section.rows.map(([key, val], i) => (
                      <div key={i} className={`flex items-center px-3 py-2 gap-3 ${i % 2 === 0 ? 'bg-gray-900' : 'bg-gray-900/50'}`}>
                        <kbd className="text-xs text-blue-300 bg-gray-800 border border-gray-700 rounded px-1.5 py-0.5 font-mono whitespace-nowrap">{key}</kbd>
                        <span className="text-xs text-gray-400">{val}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
