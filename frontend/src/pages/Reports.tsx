import { useEffect, useState } from 'react'
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, PieChart, Pie, Cell, Legend,
} from 'recharts'
import { statsApi } from '../api/client'
import type { StatsSummary, TimelinePoint } from '../types'

interface ByType { no_helmet: number; no_vest: number; no_helmet_no_vest: number }
interface HeatCell { zone: string; hour: number; count: number }

const HOURS = Array.from({ length: 24 }, (_, i) => i)
const PIE_COLORS = ['#f59e0b', '#3b82f6', '#ef4444']
const PIE_LABELS: Record<string, string> = {
  no_helmet: '헬멧 미착용', no_vest: '조끼 미착용', no_helmet_no_vest: '헬멧+조끼',
}

function HeatmapGrid({ data }: { data: HeatCell[] }) {
  const zones = [...new Set(data.map((d) => d.zone))].sort()
  if (zones.length === 0) {
    return <div className="text-center text-gray-600 py-6 text-sm">데이터 없음</div>
  }
  const lookup = new Map(data.map((d) => [`${d.zone}|${d.hour}`, d.count]))
  const maxCount = Math.max(...data.map((d) => d.count), 1)

  return (
    <div className="overflow-x-auto">
      <div style={{ minWidth: 600 }}>
        {/* hour headers */}
        <div className="flex">
          <div className="w-28 flex-shrink-0" />
          {HOURS.map((h) => (
            <div key={h} className="flex-1 text-center text-[10px] text-gray-500 pb-1">{h}</div>
          ))}
        </div>
        {zones.map((zone) => (
          <div key={zone} className="flex items-center mb-0.5">
            <div className="w-28 flex-shrink-0 text-xs text-gray-400 truncate pr-2">{zone}</div>
            {HOURS.map((h) => {
              const count = lookup.get(`${zone}|${h}`) ?? 0
              const intensity = count / maxCount
              return (
                <div
                  key={h}
                  title={`${zone} ${h}시 — ${count}건`}
                  className="flex-1 h-6 mx-px rounded-sm"
                  style={{
                    background: count === 0
                      ? '#1f2937'
                      : `rgba(239,68,68,${0.15 + intensity * 0.85})`,
                  }}
                />
              )
            })}
          </div>
        ))}
        <div className="flex items-center gap-2 mt-2 justify-end">
          <span className="text-[10px] text-gray-500">낮음</span>
          {[0.15, 0.35, 0.55, 0.75, 1].map((v) => (
            <div key={v} className="w-5 h-3 rounded-sm" style={{ background: `rgba(239,68,68,${v})` }} />
          ))}
          <span className="text-[10px] text-gray-500">높음</span>
        </div>
      </div>
    </div>
  )
}

export default function Reports() {
  const [summary, setSummary] = useState<StatsSummary | null>(null)
  const [timeline24, setTimeline24] = useState<TimelinePoint[]>([])
  const [timeline168, setTimeline168] = useState<TimelinePoint[]>([])
  const [byType, setByType] = useState<ByType | null>(null)
  const [heatmap, setHeatmap] = useState<HeatCell[]>([])
  const [byCamera, setByCamera] = useState<{ camera_id: string; camera_name: string; zone: string; count: number }[]>([])
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    statsApi.summary().then(setSummary).catch(() => {})
    statsApi.timeline({ hours: '24' }).then(setTimeline24).catch(() => {})
    statsApi.timeline({ hours: '168' }).then((pts) => {
      // Aggregate by day (average each 24-point block)
      const days: TimelinePoint[] = []
      for (let i = 0; i < pts.length; i += 24) {
        const chunk = pts.slice(i, i + 24)
        const avg = chunk.reduce((a, b) => a + b.compliance_rate, 0) / chunk.length
        const total = chunk.reduce((a, b) => a + b.violation_count, 0)
        days.push({ hour: chunk[0]?.hour ?? '', compliance_rate: Math.round(avg * 100) / 100, violation_count: total })
      }
      setTimeline168(days)
    }).catch(() => {})
    statsApi.byType(7).then(setByType).catch(() => {})
    statsApi.heatmap(7).then(setHeatmap).catch(() => {})
    statsApi.byCamera(7).then(setByCamera).catch(() => {})
  }, [])

  async function handleExport(format: 'csv' | 'json') {
    setExporting(true)
    try {
      const res = await statsApi.export(format)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `violations_report.${format}`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setExporting(false)
    }
  }

  const pct = summary ? Math.round(summary.compliance_rate * 100) : null

  function TrendBadge({ today, yesterday }: { today: number; yesterday: number }) {
    if (yesterday === 0) return null
    const delta = today - yesterday
    const sign = delta > 0 ? '+' : ''
    const color = delta > 0 ? 'text-red-400' : delta < 0 ? 'text-green-400' : 'text-gray-500'
    return (
      <span className={`text-xs ${color} ml-1`}>
        {sign}{delta} <span className="text-gray-600">전일 대비</span>
      </span>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-gray-800">
        <div>
          <h1 className="text-lg font-bold text-gray-100">보고서</h1>
          <div className="text-xs text-gray-500">안전 준수 현황 분석</div>
        </div>
        <div className="flex gap-2">
          <button className="btn-ghost" onClick={() => handleExport('csv')} disabled={exporting}>
            CSV 내보내기
          </button>
          <button className="btn-ghost" onClick={() => handleExport('json')} disabled={exporting}>
            JSON 내보내기
          </button>
        </div>
      </div>

      <div className="p-6 space-y-6">
        {/* Summary cards */}
        {summary && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="card p-4">
              <div className="text-xs text-gray-400">오늘 준수율</div>
              <div className={`text-3xl font-bold mt-1 ${
                pct! >= 90 ? 'text-green-400' : pct! >= 70 ? 'text-yellow-400' : 'text-red-400'
              }`}>{pct}%</div>
            </div>
            <div className="card p-4">
              <div className="text-xs text-gray-400">오늘 위반 건수</div>
              <div className="text-3xl font-bold mt-1 text-red-400">{summary.total_violations}</div>
              <TrendBadge today={summary.total_violations} yesterday={summary.total_violations_yesterday} />
            </div>
            <div className="card p-4">
              <div className="text-xs text-gray-400">미확인 위반</div>
              <div className={`text-3xl font-bold mt-1 ${summary.active_violations > 0 ? 'text-red-400' : 'text-gray-300'}`}>
                {summary.active_violations}
              </div>
            </div>
            <div className="card p-4">
              <div className="text-xs text-gray-400">카메라 가동률</div>
              <div className="text-3xl font-bold mt-1 text-blue-400">
                {summary.cameras_total > 0
                  ? Math.round((summary.cameras_online / summary.cameras_total) * 100)
                  : 0}%
              </div>
            </div>
          </div>
        )}

        {/* 24h violation count (line) */}
        <div className="card p-4">
          <h3 className="text-sm font-semibold text-gray-300 mb-3">시간별 위반 건수 추이 (최근 24시간)</h3>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={timeline24} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="hour" tick={{ fontSize: 10, fill: '#6b7280' }} interval={3} />
              <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: '#6b7280' }} />
              <Tooltip
                formatter={(v: number) => [v, '위반 건수']}
                contentStyle={{ background: '#1f2937', border: '1px solid #374151', fontSize: 12 }}
              />
              <Line type="monotone" dataKey="violation_count" stroke="#ef4444" dot={false} strokeWidth={2} name="위반 건수" />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* 7-day violation count */}
        <div className="card p-4">
          <h3 className="text-sm font-semibold text-gray-300 mb-3">일별 위반 건수 (최근 7일)</h3>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={timeline168} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="hour" tick={{ fontSize: 10, fill: '#6b7280' }} />
              <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} />
              <Tooltip
                contentStyle={{ background: '#1f2937', border: '1px solid #374151', fontSize: 12 }}
              />
              <Bar dataKey="violation_count" fill="#ef4444" name="위반 건수" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* 24h violation count */}
        <div className="card p-4">
          <h3 className="text-sm font-semibold text-gray-300 mb-3">시간별 위반 건수 (최근 24시간)</h3>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={timeline24} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="hour" tick={{ fontSize: 10, fill: '#6b7280' }} interval={3} />
              <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} />
              <Tooltip
                contentStyle={{ background: '#1f2937', border: '1px solid #374151', fontSize: 12 }}
              />
              <Bar dataKey="violation_count" fill="#f59e0b" name="위반 건수" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* By-camera breakdown */}
        {byCamera.length > 0 && (
          <div className="card p-4">
            <h3 className="text-sm font-semibold text-gray-300 mb-3">카메라별 위반 건수 (최근 7일)</h3>
            <ResponsiveContainer width="100%" height={Math.max(160, byCamera.length * 28)}>
              <BarChart
                data={byCamera.slice(0, 10)}
                layout="vertical"
                margin={{ top: 0, right: 40, left: 0, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" horizontal={false} />
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10, fill: '#6b7280' }} />
                <YAxis
                  type="category"
                  dataKey="camera_name"
                  width={90}
                  tick={{ fontSize: 11, fill: '#9ca3af' }}
                />
                <Tooltip
                  contentStyle={{ background: '#1f2937', border: '1px solid #374151', fontSize: 12 }}
                  formatter={(v: number, _: string, entry: any) => [
                    `${v}건`,
                    entry.payload.zone ? `${entry.payload.camera_name} (${entry.payload.zone})` : entry.payload.camera_name,
                  ]}
                />
                <Bar dataKey="count" fill="#6366f1" radius={[0, 3, 3, 0]} name="위반 건수" label={{ position: 'right', fontSize: 10, fill: '#6b7280' }} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* PPE type breakdown */}
        {byType && (
          <div className="card p-4">
            <h3 className="text-sm font-semibold text-gray-300 mb-3">보호구 유형별 위반 비율 (최근 7일)</h3>
            <div className="flex items-center gap-6">
              <ResponsiveContainer width={180} height={180}>
                <PieChart>
                  <Pie
                    data={[
                      { name: PIE_LABELS.no_helmet, value: byType.no_helmet },
                      { name: PIE_LABELS.no_vest, value: byType.no_vest },
                      { name: PIE_LABELS.no_helmet_no_vest, value: byType.no_helmet_no_vest },
                    ]}
                    cx="50%" cy="50%"
                    innerRadius={48} outerRadius={80}
                    paddingAngle={2} dataKey="value"
                  >
                    {PIE_COLORS.map((color, i) => <Cell key={i} fill={color} />)}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: '#1f2937', border: '1px solid #374151', fontSize: 12 }}
                    formatter={(v: number) => [v, '건']}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex flex-col gap-2">
                {([
                  { key: 'no_helmet', color: PIE_COLORS[0], count: byType.no_helmet },
                  { key: 'no_vest', color: PIE_COLORS[1], count: byType.no_vest },
                  { key: 'no_helmet_no_vest', color: PIE_COLORS[2], count: byType.no_helmet_no_vest },
                ] as const).map(({ key, color, count }) => {
                  const total = byType.no_helmet + byType.no_vest + byType.no_helmet_no_vest
                  const pct = total > 0 ? Math.round((count / total) * 100) : 0
                  return (
                    <div key={key} className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-sm flex-shrink-0" style={{ background: color }} />
                      <span className="text-xs text-gray-400">{PIE_LABELS[key]}</span>
                      <span className="text-xs font-mono text-gray-200 ml-auto pl-4">{count}건 ({pct}%)</span>
                    </div>
                  )
                })}
                <div className="text-xs text-gray-600 mt-1 border-t border-gray-700 pt-1">
                  합계: {byType.no_helmet + byType.no_vest + byType.no_helmet_no_vest}건
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Zone × hour heatmap */}
        <div className="card p-4">
          <h3 className="text-sm font-semibold text-gray-300 mb-3">구역·시간대별 위반 히트맵 (최근 7일)</h3>
          <p className="text-xs text-gray-500 mb-3">가로축: 시간 (0–23시) · 세로축: 구역</p>
          <HeatmapGrid data={heatmap} />
        </div>
      </div>
    </div>
  )
}
