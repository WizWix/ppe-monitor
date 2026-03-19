import type { ComplianceStatus } from '../types'

export function ComplianceBadge({ status }: { status: ComplianceStatus }) {
  if (status === 'compliant') return <span className="badge-compliant">정상</span>
  if (status === 'partial') return <span className="badge-partial">부분착용</span>
  return <span className="badge-violation">미착용</span>
}

export function StatusDot({ status }: { status: 'online' | 'offline' | 'error' }) {
  const cls = status === 'online' ? 'bg-green-400' : status === 'error' ? 'bg-red-400' : 'bg-gray-500'
  return <span className={`inline-block w-2 h-2 rounded-full ${cls}`} />
}
