import { create } from 'zustand'
import type { User, Camera, AppAlert, ViolationType } from '../types'

// ── Auth store ────────────────────────────────────────────────────────────────
interface AuthState {
  token: string | null
  user: User | null
  setToken: (token: string) => void
  setUser: (user: User) => void
  logout: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  token: localStorage.getItem('token'),
  user: null,
  setToken: (token) => {
    localStorage.setItem('token', token)
    set({ token })
  },
  setUser: (user) => set({ user }),
  logout: () => {
    localStorage.removeItem('token')
    set({ token: null, user: null })
  },
}))

// ── Camera store ──────────────────────────────────────────────────────────────
interface CameraState {
  cameras: Camera[]
  setCameras: (cameras: Camera[]) => void
  updateCamera: (id: string, patch: Partial<Camera>) => void
}

export const useCameraStore = create<CameraState>((set) => ({
  cameras: [],
  setCameras: (cameras) => set({ cameras }),
  updateCamera: (id, patch) =>
    set((s) => ({
      cameras: s.cameras.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    })),
}))

// ── Alert store ───────────────────────────────────────────────────────────────
let _alertSeq = 0

interface AlertState {
  alerts: AppAlert[]
  pushAlert: (alert: Omit<AppAlert, 'id' | 'acknowledged'>) => void
  acknowledge: (id: string) => void
  clear: () => void
}

export const useAlertStore = create<AlertState>((set) => ({
  alerts: [],
  pushAlert: (alert) =>
    set((s) => ({
      alerts: [
        { ...alert, id: String(++_alertSeq), acknowledged: false },
        ...s.alerts.slice(0, 99),  // keep last 100
      ],
    })),
  acknowledge: (id) =>
    set((s) => ({
      alerts: s.alerts.map((a) => (a.id === id ? { ...a, acknowledged: true } : a)),
    })),
  clear: () => set({ alerts: [] }),
}))

// ── Frame store (shared across all tiles — one WS per camera) ─────────────────
import type { CameraFrame } from '../types'

interface FrameState {
  frames: Record<string, CameraFrame>
  setFrame: (cameraId: string, frame: CameraFrame) => void
  clearFrame: (cameraId: string) => void
}

export const useFrameStore = create<FrameState>((set) => ({
  frames: {},
  setFrame: (cameraId, frame) =>
    set((s) => ({ frames: { ...s.frames, [cameraId]: frame } })),
  clearFrame: (cameraId) =>
    set((s) => {
      const { [cameraId]: _, ...rest } = s.frames
      return { frames: rest }
    }),
}))

// ── Helper to derive violation type from detection ─────────────────────────
export function toViolationType(helmet: boolean, vest: boolean): ViolationType {
  if (!helmet && !vest) return 'no_helmet_no_vest'
  if (!helmet) return 'no_helmet'
  return 'no_vest'
}

// ── Settings store (persisted to localStorage) ────────────────────────────────
interface SettingsState {
  ttsEnabled: boolean
  setTtsEnabled: (v: boolean) => void
}

export const useSettingsStore = create<SettingsState>((set) => ({
  ttsEnabled: localStorage.getItem('ppe-tts') === 'true',
  setTtsEnabled: (ttsEnabled) => {
    localStorage.setItem('ppe-tts', String(ttsEnabled))
    set({ ttsEnabled })
  },
}))

// ── TTS helper ────────────────────────────────────────────────────────────────
const TTS_TEXT: Record<string, string> = {
  no_helmet:          '안전모 미착용이 감지되었습니다.',
  no_vest:            '반사조끼 미착용이 감지되었습니다.',
  no_helmet_no_vest:  '안전모와 반사조끼 미착용이 감지되었습니다.',
}

export function speakViolation(type: string, cameraName: string) {
  if (!window.speechSynthesis) return
  const msg = `${TTS_TEXT[type] ?? '보호구 미착용 감지.'} ${cameraName}.`
  const utter = new SpeechSynthesisUtterance(msg)
  utter.lang = 'ko-KR'
  utter.rate = 1.05
  window.speechSynthesis.cancel()
  window.speechSynthesis.speak(utter)
}
