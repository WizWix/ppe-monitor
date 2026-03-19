const BASE = '/api'

function getToken(): string | null {
  return localStorage.getItem('token')
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken()
  const res = await fetch(BASE + path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  })
  if (!res.ok) {
    if (res.status === 401) {
      localStorage.removeItem('token')
      if (window.location.pathname !== '/login') {
        window.location.href = '/login'
      }
    }
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail ?? 'Request failed')
  }
  if (res.status === 204) return undefined as T
  return res.json()
}

// ── Auth ──────────────────────────────────────────────────────────────────────
export const authApi = {
  login: (email: string, password: string) =>
    request<{ access_token: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  me: () => request<import('../types').User>('/auth/me'),
  changePassword: (old_password: string, new_password: string) =>
    request<void>('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ old_password, new_password }),
    }),
  updateProfile: (name: string) =>
    request<import('../types').User>('/auth/me', {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    }),
}

// ── Cameras ───────────────────────────────────────────────────────────────────
export const camerasApi = {
  list: () => request<import('../types').Camera[]>('/cameras'),
  get: (id: string) => request<import('../types').Camera>(`/cameras/${id}`),
  create: (data: unknown) => request<import('../types').Camera>('/cameras', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: unknown) => request<import('../types').Camera>(`/cameras/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: string) => request<void>(`/cameras/${id}`, { method: 'DELETE' }),
  start: (id: string) => request<{ status: string }>(`/cameras/${id}/start`, { method: 'POST' }),
  stop: (id: string) => request<{ status: string }>(`/cameras/${id}/stop`, { method: 'POST' }),
}

// ── Violations ────────────────────────────────────────────────────────────────
export const violationsApi = {
  list: (params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : ''
    return request<import('../types').Violation[]>(`/violations${qs}`)
  },
  get: (id: number) => request<import('../types').Violation>(`/violations/${id}`),
  acknowledge: (id: number, note = '') =>
    request<import('../types').Violation>(`/violations/${id}/acknowledge`, {
      method: 'PUT',
      body: JSON.stringify({ note }),
    }),
}

// ── Stats ─────────────────────────────────────────────────────────────────────
export const statsApi = {
  summary: () => request<import('../types').StatsSummary>('/stats/summary'),
  timeline: (params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : ''
    return request<import('../types').TimelinePoint[]>(`/stats/timeline${qs}`)
  },
  byType: (days = 7) =>
    request<{ no_helmet: number; no_vest: number; no_helmet_no_vest: number }>(
      `/stats/by-type?days=${days}`
    ),
  heatmap: (days = 7) =>
    request<{ zone: string; hour: number; count: number }[]>(
      `/stats/heatmap?days=${days}`
    ),
  byCamera: (days = 7) =>
    request<{ camera_id: string; camera_name: string; zone: string; count: number }[]>(
      `/stats/by-camera?days=${days}`
    ),
  export: (format: 'csv' | 'json', params?: Record<string, string>) => {
    const qs = new URLSearchParams({ format, ...(params ?? {}) }).toString()
    const token = getToken()
    return fetch(`${BASE}/reports/export?${qs}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
  },
}

// ── Users ─────────────────────────────────────────────────────────────────────
export const usersApi = {
  list: () => request<import('../types').User[]>('/users'),
  create: (data: unknown) => request<import('../types').User>('/users', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: number, data: unknown) => request<import('../types').User>(`/users/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: number) => request<void>(`/users/${id}`, { method: 'DELETE' }),
}

// ── System settings ───────────────────────────────────────────────────────────
export interface SystemInfo {
  infer_every_n_override: number | null
  infer_every_n_effective: number
  gpu_ms_per_frame: number
  mode: string
  stream_fps_override: number | null
  stream_fps_effective: number
  stream_fps_default: number
}

export const systemApi = {
  get: () => request<SystemInfo>('/system'),
  patch: (data: { infer_every_n?: number | null; auto?: boolean; stream_fps?: number }) =>
    request<SystemInfo>('/system', {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
}

// ── Violations (snapshot URL helper) ─────────────────────────────────────────
export const snapshotUrl = (violationId: number) =>
  `/api/violations/${violationId}/snapshot`

// ── Alert Rules ───────────────────────────────────────────────────────────────
export const alertRulesApi = {
  list: () => request<import('../types').AlertRule[]>('/alert-rules'),
  create: (data: unknown) => request<import('../types').AlertRule>('/alert-rules', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: number, data: unknown) => request<import('../types').AlertRule>(`/alert-rules/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: number) => request<void>(`/alert-rules/${id}`, { method: 'DELETE' }),
}
