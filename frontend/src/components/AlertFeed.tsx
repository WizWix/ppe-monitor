import { format } from 'date-fns'
import { useNavigate } from 'react-router-dom'
import { useAlertStore } from '../store'
import type { AppAlert } from '../types'

const VIOLATION_LABEL: Record<string, string> = {
  no_helmet: '헬멧 미착용',
  no_vest: '조끼 미착용',
  no_helmet_no_vest: '헬멧+조끼 미착용',
}

function AlertRow({ alert }: { alert: AppAlert }) {
  const { acknowledge } = useAlertStore()
  const navigate = useNavigate()

  return (
    <div
      className={`px-3 py-2 border-b border-gray-800 ${
        alert.acknowledged ? 'opacity-50' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="text-xs text-gray-500">
            {format(new Date(alert.timestamp), 'HH:mm:ss')} · {alert.camera_name}
          </div>
          <div className="text-sm text-red-300 font-semibold mt-0.5">
            작업자 #{alert.track_id} — {VIOLATION_LABEL[alert.type] ?? alert.type}
          </div>
        </div>
        {!alert.acknowledged && (
          <div className="flex gap-1 flex-shrink-0">
            <button
              className="text-xs text-blue-400 hover:text-blue-300 px-1"
              onClick={() => navigate(`/cameras/${alert.camera_id}`)}
            >
              보기
            </button>
            <button
              className="text-xs text-gray-400 hover:text-gray-200 px-1"
              onClick={() => acknowledge(alert.id)}
            >
              확인
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default function AlertFeed() {
  const { alerts, clear } = useAlertStore()
  const unread = alerts.filter((a) => !a.acknowledged)
  const read = alerts.filter((a) => a.acknowledged).slice(0, 10)

  return (
    <div className="card flex flex-col overflow-hidden h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700">
        <span className="text-sm font-semibold text-gray-200">알림 피드</span>
        {alerts.length > 0 && (
          <button className="text-xs text-gray-500 hover:text-gray-300" onClick={clear}>
            전체 지우기
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {alerts.length === 0 && (
          <div className="flex items-center justify-center h-32 text-gray-600 text-sm">
            알림 없음
          </div>
        )}
        {unread.map((a) => (
          <AlertRow key={a.id} alert={a} />
        ))}
        {read.length > 0 && (
          <>
            <div className="px-3 py-1 text-xs text-gray-600 bg-gray-900 border-b border-gray-800">
              확인됨
            </div>
            {read.map((a) => (
              <AlertRow key={a.id} alert={a} />
            ))}
          </>
        )}
      </div>
    </div>
  )
}
