import { Navigate } from 'react-router-dom'
import { useAuthStore } from '../store'
import type { UserRole } from '../types'

interface Props {
  children: React.ReactNode
  roles?: UserRole[]
}

export default function ProtectedRoute({ children, roles }: Props) {
  const { token, user } = useAuthStore()
  if (!token) return <Navigate to="/login" replace />
  if (roles && user && !roles.includes(user.role)) {
    return (
      <div className="flex items-center justify-center h-full text-red-400 text-lg">
        권한이 없습니다.
      </div>
    )
  }
  return <>{children}</>
}
