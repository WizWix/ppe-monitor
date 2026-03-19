import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { violationsApi, camerasApi, snapshotUrl } from '../api/client'
import type { Violation, Camera } from '../types'

function SnapshotThumb({ violationId }: { violationId: number }) {
  const [open, setOpen] = useState(false)
  const url = snapshotUrl(violationId)
  return (
    <>
      <img
        src={url}
        alt="스냅샷"
        className="w-12 h-9 object-cover rounded cursor-pointer border border-gray-700 hover:border-gray-400 transition-colors"
        onClick={() => setOpen(true)}
        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
      />
      {open && (
        <div
          className="fixed inset-0 bg-black/80 flex items-center justify-center z-50"
          onClick={() => setOpen(false)}
        >
          <img
            src={url}
            alt="스냅샷 전체"
            className="max-w-[90vw] max-h-[90vh] rounded shadow-2xl border border-gray-600"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  )
}

const TYPE_LABEL: Record<string, string> = {
  no_helmet: '헬멧 미착용',
  no_vest: '조끼 미착용',
  no_helmet_no_vest: '헬멧+조끼 미착용',
}

const STATUS_LABEL: Record<string, string> = {
  unacknowledged: '미확인',
  acknowledged: '확인됨',
}

function AckModal({
  violation,
  onClose,
  onDone,
}: {
  violation: Violation
  onClose: () => void
  onDone: () => void
}) {
  const [note, setNote] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit() {
    setLoading(true)
    try {
      await violationsApi.acknowledge(violation.id, note)
      onDone()
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="card p-6 w-full max-w-md">
        <h3 className="font-semibold mb-4">위반 확인 — #{violation.id}</h3>
        <div className="text-sm text-gray-400 mb-2">
          {violation.camera_name} · {TYPE_LABEL[violation.type]}
        </div>
        <div className="text-xs text-gray-500 mb-4">
          {format(new Date(violation.started_at), 'yyyy-MM-dd HH:mm:ss')}
        </div>
        <label className="label">메모 (선택)</label>
        <textarea
          className="input h-20 resize-none mb-4"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="조치 내용을 입력하세요"
        />
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>취소</button>
          <button className="btn-primary" onClick={submit} disabled={loading}>
            {loading ? '처리 중...' : '확인 처리'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function Violations() {
  const [violations, setViolations] = useState<Violation[]>([])
  const [cameras, setCameras] = useState<Camera[]>([])
  const [loading, setLoading] = useState(false)
  const [ackTarget, setAckTarget] = useState<Violation | null>(null)

  // Filters
  const [filterCamera, setFilterCamera] = useState('')
  const [filterType, setFilterType] = useState('')
  const [filterStatus, setFilterStatus] = useState('')

  async function load() {
    setLoading(true)
    try {
      const params: Record<string, string> = {}
      if (filterCamera) params.camera_id = filterCamera
      if (filterType) params.type = filterType
      if (filterStatus) params.status = filterStatus
      const data = await violationsApi.list(params)
      setViolations(data)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    camerasApi.list().then(setCameras).catch(() => {})
  }, [])

  useEffect(() => {
    load()
  }, [filterCamera, filterType, filterStatus])

  const unread = violations.filter((v) => v.status === 'unacknowledged').length

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-gray-800">
        <div>
          <h1 className="text-lg font-bold text-gray-100">위반 이력</h1>
          <div className="text-xs text-gray-500">
            {unread > 0 ? <span className="text-red-400">{unread}건 미확인</span> : '모두 확인됨'}
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3 px-6 py-3 border-b border-gray-800 flex-wrap">
        <select
          className="input w-40"
          value={filterCamera}
          onChange={(e) => setFilterCamera(e.target.value)}
        >
          <option value="">전체 카메라</option>
          {cameras.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <select className="input w-44" value={filterType} onChange={(e) => setFilterType(e.target.value)}>
          <option value="">전체 위반 유형</option>
          <option value="no_helmet">헬멧 미착용</option>
          <option value="no_vest">조끼 미착용</option>
          <option value="no_helmet_no_vest">헬멧+조끼 미착용</option>
        </select>
        <select className="input w-36" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
          <option value="">전체 상태</option>
          <option value="unacknowledged">미확인</option>
          <option value="acknowledged">확인됨</option>
        </select>
        <button className="btn-ghost" onClick={load}>새로고침</button>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center h-40 text-gray-500">불러오는 중...</div>
        ) : violations.length === 0 ? (
          <div className="flex items-center justify-center h-40 text-gray-600">위반 기록이 없습니다.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-gray-900 text-xs text-gray-400 border-b border-gray-700">
              <tr>
                <th className="px-4 py-2 text-left">ID</th>
                <th className="px-4 py-2 text-left">스냅샷</th>
                <th className="px-4 py-2 text-left">카메라</th>
                <th className="px-4 py-2 text-left">구역</th>
                <th className="px-4 py-2 text-left">위반 유형</th>
                <th className="px-4 py-2 text-left">발생 시각</th>
                <th className="px-4 py-2 text-left">지속 시간</th>
                <th className="px-4 py-2 text-left">상태</th>
                <th className="px-4 py-2 text-left">처리자</th>
                <th className="px-4 py-2 text-left">작업</th>
              </tr>
            </thead>
            <tbody>
              {violations.map((v) => (
                <tr
                  key={v.id}
                  className={`border-b border-gray-800 hover:bg-gray-900/50 ${
                    v.status === 'unacknowledged' ? 'bg-red-950/20' : ''
                  }`}
                >
                  <td className="px-4 py-2 text-gray-500">#{v.id}</td>
                  <td className="px-4 py-2"><SnapshotThumb violationId={v.id} /></td>
                  <td className="px-4 py-2 text-gray-200">{v.camera_name || v.camera_id}</td>
                  <td className="px-4 py-2 text-gray-400">{v.zone || '-'}</td>
                  <td className="px-4 py-2">
                    <span className={`text-xs px-2 py-0.5 rounded border ${
                      v.type === 'no_helmet_no_vest'
                        ? 'bg-red-900 text-red-300 border-red-700'
                        : 'bg-yellow-900 text-yellow-300 border-yellow-700'
                    }`}>
                      {TYPE_LABEL[v.type] ?? v.type}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-gray-400 whitespace-nowrap">
                    {format(new Date(v.started_at), 'MM-dd HH:mm:ss')}
                  </td>
                  <td className="px-4 py-2 text-gray-400">{v.duration_seconds.toFixed(1)}초</td>
                  <td className="px-4 py-2">
                    <span className={`text-xs ${
                      v.status === 'unacknowledged' ? 'text-red-400' : 'text-gray-500'
                    }`}>
                      {STATUS_LABEL[v.status] ?? v.status}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-gray-500 text-xs">{v.acknowledged_by || '-'}</td>
                  <td className="px-4 py-2">
                    <div className="flex gap-2 items-center">
                      {v.status === 'unacknowledged' && (
                        <button
                          className="text-xs text-blue-400 hover:text-blue-300"
                          onClick={() => setAckTarget(v)}
                        >
                          확인
                        </button>
                      )}
                      {v.note && (
                        <span className="text-xs text-gray-600" title={v.note}>📝</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {ackTarget && (
        <AckModal
          violation={ackTarget}
          onClose={() => setAckTarget(null)}
          onDone={() => {
            setAckTarget(null)
            load()
          }}
        />
      )}
    </div>
  )
}
