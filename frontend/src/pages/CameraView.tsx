import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { format } from 'date-fns'
import { camerasApi, statsApi } from '../api/client'
import type { Camera, TimelinePoint } from '../types'
import { useCameraStream } from '../hooks/useCameraStream'
import VideoOverlay from '../components/VideoOverlay'
import { StatusDot, ComplianceBadge } from '../components/ComplianceBadge'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'

export default function CameraView() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [camera, setCamera] = useState<Camera | null>(null)
  const [timeline, setTimeline] = useState<TimelinePoint[]>([])
  const { frame, connected } = useCameraStream(id ?? null)

  useEffect(() => {
    if (!id) return
    camerasApi.get(id).then(setCamera).catch(() => navigate('/'))
    statsApi.timeline({ camera_id: id, hours: '12' }).then(setTimeline).catch(() => {})
    const interval = setInterval(() => {
      statsApi.timeline({ camera_id: id, hours: '12' }).then(setTimeline).catch(() => {})
    }, 30_000)
    return () => clearInterval(interval)
  }, [id, navigate])

  const summary = frame?.summary ?? camera?.current_summary

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-3 border-b border-gray-800">
        <button onClick={() => navigate('/')} className="text-gray-400 hover:text-gray-200 text-sm">
          ← 대시보드
        </button>
        <div className="flex items-center gap-2">
          <StatusDot status={camera?.status ?? 'offline'} />
          <span className="font-semibold">{camera?.name ?? id}</span>
          <span className="text-gray-500 text-sm">{camera?.zone}</span>
        </div>
        {connected && (
          <span className="ml-auto bg-red-700 text-white text-xs px-2 py-0.5 rounded font-bold animate-pulse">LIVE</span>
        )}
        {!connected && (
          <span className="ml-auto text-yellow-500 text-xs">연결 중...</span>
        )}
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Video */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 bg-black flex items-center justify-center overflow-hidden">
            {frame ? (
              <VideoOverlay frame={frame} className="max-w-full max-h-full object-contain" />
            ) : (
              <div className="text-gray-600">카메라 연결 대기 중...</div>
            )}
          </div>

          {/* Timeline */}
          <div className="h-28 border-t border-gray-800 px-4 pt-2">
            <div className="text-xs text-gray-500 mb-1">시간별 위반 건수 (최근 12시간)</div>
            <ResponsiveContainer width="100%" height={80}>
              <LineChart data={timeline} margin={{ top: 2, right: 8, left: -20, bottom: 2 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="hour" tick={{ fontSize: 10, fill: '#6b7280' }} interval={2} />
                <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: '#6b7280' }} />
                <Tooltip
                  formatter={(v: number) => [v, '위반 건수']}
                  contentStyle={{ background: '#1f2937', border: '1px solid #374151', fontSize: 12 }}
                />
                <Line type="monotone" dataKey="violation_count" stroke="#ef4444" dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Sidebar */}
        <div className="w-60 flex-shrink-0 border-l border-gray-800 flex flex-col overflow-hidden">
          {/* Live detections */}
          <div className="border-b border-gray-800 p-3">
            <div className="text-xs font-semibold text-gray-400 mb-2">실시간 감지</div>
            {frame?.detections.length === 0 && (
              <div className="text-xs text-gray-600">감지된 작업자 없음</div>
            )}
            <div className="space-y-1">
              {frame?.detections.map((det) => (
                <div key={det.track_id} className="flex items-center justify-between text-xs">
                  <span className="text-gray-300">#{det.track_id}</span>
                  <span className="text-gray-500">
                    H:{det.helmet ? '✓' : '✗'} V:{det.vest ? '✓' : '✗'}
                  </span>
                  <ComplianceBadge status={det.status} />
                </div>
              ))}
            </div>
          </div>

          {/* Stats */}
          {summary && (
            <div className="p-3 space-y-2">
              <div className="text-xs font-semibold text-gray-400 mb-2">현황</div>
              <div className="flex justify-between text-xs">
                <span className="text-gray-400">총 인원</span>
                <span className="text-white">{summary.total_persons}명</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-green-400">정상</span>
                <span className="text-white">{summary.compliant}명</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-yellow-400">부분착용</span>
                <span className="text-white">{summary.partial}명</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-red-400">미착용</span>
                <span className="text-white">{summary.non_compliant}명</span>
              </div>
              <div className="flex justify-between text-xs border-t border-gray-800 pt-2">
                <span className="text-gray-400">준수율</span>
                <span className={`font-bold ${
                  summary.compliance_rate >= 0.9 ? 'text-green-400' :
                  summary.compliance_rate >= 0.7 ? 'text-yellow-400' : 'text-red-400'
                }`}>
                  {Math.round(summary.compliance_rate * 100)}%
                </span>
              </div>
            </div>
          )}

          {/* Camera info */}
          {camera && (
            <div className="mt-auto border-t border-gray-800 p-3 space-y-1">
              <div className="text-xs font-semibold text-gray-400 mb-1">카메라 정보</div>
              <div className="text-xs text-gray-500">소스: {camera.source}</div>
              <div className="text-xs text-gray-500">헬멧 임계값: {camera.conf_helmet}</div>
              <div className="text-xs text-gray-500">조끼 임계값: {camera.conf_vest}</div>
              <div className="text-xs text-gray-500">
                마지막 프레임: {frame ? format(new Date(frame.timestamp), 'HH:mm:ss') : '-'}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
