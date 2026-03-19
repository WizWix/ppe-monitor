import { useState, FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { authApi } from '../api/client'
import { useAuthStore } from '../store'

export default function Login() {
  const [email, setEmail] = useState('admin@ppe.local')
  const [password, setPassword] = useState('admin1234')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { setToken, setUser } = useAuthStore()
  const navigate = useNavigate()

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const { access_token } = await authApi.login(email, password)
      setToken(access_token)
      const user = await authApi.me()
      setUser(user)
      navigate('/')
    } catch (err: any) {
      setError(err.message ?? '로그인 실패')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-3xl font-bold text-blue-400 mb-1">PPE MONITOR</div>
          <div className="text-gray-400 text-sm">안전장구 감지 모니터링 시스템</div>
        </div>

        <div className="card p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label">이메일</label>
              <input
                type="email"
                className="input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
              />
            </div>
            <div>
              <label className="label">비밀번호</label>
              <input
                type="password"
                className="input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            {error && <div className="text-red-400 text-sm">{error}</div>}
            <button type="submit" className="btn-primary w-full py-2" disabled={loading}>
              {loading ? '로그인 중...' : '로그인'}
            </button>
          </form>
        </div>

        <div className="mt-4 text-xs text-gray-600 text-center space-y-1">
          <div>기본 계정: admin@ppe.local / admin1234</div>
          <div>안전담당자: safety@ppe.local / safety1234</div>
        </div>
      </div>
    </div>
  )
}
