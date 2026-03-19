import { NavLink, useNavigate } from 'react-router-dom'
import { useAuthStore, useAlertStore } from '../store'

const ROLE_LABEL: Record<string, string> = {
  viewer: '뷰어',
  safety_officer: '안전담당자',
  site_manager: '현장관리자',
  admin: '관리자',
}

const links = [
  { to: '/', label: '모니터', icon: '▦' },
  { to: '/violations', label: '위반 이력', icon: '🚨' },
  { to: '/reports', label: '보고서', icon: '📊' },
  { to: '/settings', label: '설정', icon: '⚙' },
]

interface Props {
  collapsed: boolean
  onToggle: () => void
}

export default function Sidebar({ collapsed, onToggle }: Props) {
  const { user, logout } = useAuthStore()
  const { alerts } = useAlertStore()
  const navigate = useNavigate()
  const unread = alerts.filter((a) => !a.acknowledged).length

  function handleLogout() {
    logout()
    navigate('/login')
  }

  return (
    <aside
      className={`flex-shrink-0 bg-gray-900 border-r border-gray-700 flex flex-col transition-all duration-200 ${
        collapsed ? 'w-12' : 'w-48'
      }`}
    >
      {/* Logo + toggle */}
      <div className={`flex items-center border-b border-gray-700 h-10 ${collapsed ? 'justify-center' : 'px-3 gap-2'}`}>
        {!collapsed && <span className="text-blue-400 font-bold text-xs flex-1">PPE MONITOR</span>}
        <button
          onClick={onToggle}
          className="text-gray-400 hover:text-gray-200 text-sm w-6 h-6 flex items-center justify-center"
          title={collapsed ? '펼치기' : '접기'}
        >
          {collapsed ? '▶' : '◀'}
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 py-1">
        {links.map((l) => (
          <NavLink
            key={l.to}
            to={l.to}
            end={l.to === '/'}
            title={collapsed ? l.label : undefined}
            className={({ isActive }) =>
              `flex items-center gap-2 px-3 py-2.5 text-sm transition-colors ${
                isActive
                  ? 'bg-blue-900/50 text-blue-300 border-r-2 border-blue-400'
                  : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
              }`
            }
          >
            <span className="text-base flex-shrink-0">{l.icon}</span>
            {!collapsed && (
              <>
                <span className="flex-1">{l.label}</span>
                {l.to === '/violations' && unread > 0 && (
                  <span className="bg-red-600 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
                    {unread > 9 ? '9+' : unread}
                  </span>
                )}
              </>
            )}
            {collapsed && l.to === '/violations' && unread > 0 && (
              <span className="absolute left-7 top-1 bg-red-600 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center">
                {unread > 9 ? '9' : unread}
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      {/* User */}
      {!collapsed && (
        <div className="px-3 py-2 border-t border-gray-700">
          <button onClick={() => navigate('/settings/account')} className="text-xs text-gray-300 hover:text-gray-100 text-left w-full">
            <span className="truncate block">{user?.name}</span>
            <span className="text-[11px] text-gray-500">{ROLE_LABEL[user?.role ?? ''] ?? user?.role}</span>
          </button>
          <button onClick={handleLogout} className="mt-1 text-xs text-red-400 hover:text-red-300">
            로그아웃
          </button>
        </div>
      )}
    </aside>
  )
}
