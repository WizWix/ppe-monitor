import type { StatsSummary } from '../types'

interface Props {
  summary: StatsSummary | null
}

function KPICard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className="card px-5 py-4 flex flex-col gap-1">
      <div className="text-xs text-gray-400">{label}</div>
      <div className={`text-3xl font-bold ${color ?? 'text-white'}`}>{value}</div>
      {sub && <div className="text-xs text-gray-500">{sub}</div>}
    </div>
  )
}

export default function KPIStrip({ summary }: Props) {
  if (!summary) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card px-5 py-4 animate-pulse h-20 bg-gray-800" />
        ))}
      </div>
    )
  }

  const pct = Math.round(summary.compliance_rate * 100)
  const pctColor = pct >= 90 ? 'text-green-400' : pct >= 70 ? 'text-yellow-400' : 'text-red-400'

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <KPICard label="오늘 준수율" value={`${pct}%`} sub="전체 작업자 기준" color={pctColor} />
      <KPICard
        label="미확인 위반"
        value={summary.active_violations}
        sub="즉시 조치 필요"
        color={summary.active_violations > 0 ? 'text-red-400' : 'text-gray-300'}
      />
      <KPICard label="현재 감지 인원" value={summary.total_persons_today} sub="실시간" />
      <KPICard
        label="카메라 현황"
        value={`${summary.cameras_online} / ${summary.cameras_total}`}
        sub="온라인 / 전체"
        color={summary.cameras_online < summary.cameras_total ? 'text-yellow-400' : 'text-green-400'}
      />
    </div>
  )
}
