import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './store'
import { authApi } from './api/client'
import Layout from './components/Layout'
import ProtectedRoute from './components/ProtectedRoute'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import CameraView from './pages/CameraView'
import Violations from './pages/Violations'
import Reports from './pages/Reports'
import Settings from './pages/Settings'

export default function App() {
  const { token, setUser, logout } = useAuthStore()
  const [authChecked, setAuthChecked] = useState(!token)

  // Validate token on mount — until verified, don't render protected routes
  useEffect(() => {
    if (!token) {
      setAuthChecked(true)
      return
    }
    authApi
      .me()
      .then((user) => {
        setUser(user)
        setAuthChecked(true)
      })
      .catch(() => {
        logout()
        setAuthChecked(true)
      })
  }, [])

  if (!authChecked) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-950 text-gray-400 text-sm">
        인증 확인 중...
      </div>
    )
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }
        >
          <Route index element={<Dashboard />} />
          <Route path="cameras/:id" element={<CameraView />} />
          <Route path="cameras" element={<Navigate to="/" replace />} />
          <Route path="violations" element={<Violations />} />
          <Route path="reports" element={<Reports />} />
          <Route path="settings/*" element={<Settings />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
