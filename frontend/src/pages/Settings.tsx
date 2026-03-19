import { useEffect, useRef, useState } from 'react'
import { Routes, Route, NavLink, useNavigate } from 'react-router-dom'
import { authApi, camerasApi, alertRulesApi, usersApi, systemApi } from '../api/client'
import type { SystemInfo } from '../api/client'
import type { Camera, AlertRule, User, UserRole } from '../types'
import { useAuthStore, useCameraStore, useSettingsStore } from '../store'

// ── Shared UI atoms ────────────────────────────────────────────────────────────

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`relative inline-flex w-9 h-5 rounded-full transition-colors flex-shrink-0 ${
        checked ? 'bg-blue-600' : 'bg-gray-700'
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
          checked ? 'translate-x-4' : ''
        }`}
      />
    </button>
  )
}

function Toast({ msg, onDone }: { msg: string; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 2200)
    return () => clearTimeout(t)
  }, [onDone])
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-gray-800 border border-gray-600 text-gray-200 text-sm px-4 py-2 rounded shadow-xl z-50">
      {msg}
    </div>
  )
}

function useToast() {
  const [msg, setMsg] = useState<string | null>(null)
  const show = (m: string) => setMsg(m)
  const el = msg ? <Toast msg={msg} onDone={() => setMsg(null)} /> : null
  return { show, el }
}

const CHANNELS = [
  { value: 'in_app', label: '인앱' },
  { value: 'email', label: '이메일' },
  { value: 'sms', label: 'SMS' },
  { value: 'slack', label: 'Slack' },
]

function ChannelCheckboxes({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const selected = value.split(',').map((s) => s.trim()).filter(Boolean)
  const toggle = (ch: string) => {
    const next = selected.includes(ch) ? selected.filter((c) => c !== ch) : [...selected, ch]
    onChange(next.join(','))
  }
  return (
    <div className="flex flex-wrap gap-3">
      {CHANNELS.map((ch) => (
        <label key={ch.value} className="flex items-center gap-1.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={selected.includes(ch.value)}
            onChange={() => toggle(ch.value)}
            className="accent-blue-500"
          />
          <span className="text-sm text-gray-300">{ch.label}</span>
        </label>
      ))}
    </div>
  )
}

// ── Sub-nav ───────────────────────────────────────────────────────────────────
function SettingsNav() {
  const { user } = useAuthStore()
  const tabs = [
    { to: '/settings/cameras', label: '카메라 관리' },
    { to: '/settings/alerts', label: '알림 규칙' },
    { to: '/settings/system', label: '시스템' },
    ...(user?.role === 'admin' ? [{ to: '/settings/users', label: '사용자 관리' }] : []),
    { to: '/settings/account', label: '내 계정' },
  ]
  return (
    <div className="flex gap-1 px-6 py-2 border-b border-gray-800 flex-wrap">
      {tabs.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          className={({ isActive }) =>
            `px-3 py-1.5 text-sm rounded transition-colors ${
              isActive ? 'bg-blue-900/50 text-blue-300' : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
            }`
          }
        >
          {t.label}
        </NavLink>
      ))}
    </div>
  )
}

// ── Camera row ────────────────────────────────────────────────────────────────
const CAM_FORM_DEFAULT = { name: '', zone: '', source: '', conf_helmet: 0.65, conf_vest: 0.70 }

function CameraRow({ cam, canEdit, onRefresh, onToast }: {
  cam: Camera; canEdit: boolean; onRefresh: () => void; onToast: (m: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({
    name: cam.name, zone: cam.zone, source: cam.source,
    conf_helmet: cam.conf_helmet, conf_vest: cam.conf_vest,
  })
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    setSaving(true)
    try {
      await camerasApi.update(cam.id, form)
      setEditing(false)
      onRefresh()
      onToast('저장되었습니다.')
    } catch (e: any) { alert(e.message) } finally { setSaving(false) }
  }

  async function handleToggle() {
    try {
      if (cam.status === 'online') await camerasApi.stop(cam.id)
      else await camerasApi.start(cam.id)
      onRefresh()
    } catch (e: any) { alert(e.message) }
  }

  async function handleDelete() {
    if (!confirm(`카메라 "${cam.name}"을 삭제하시겠습니까?`)) return
    await camerasApi.delete(cam.id)
    onRefresh()
  }

  return (
    <div className="card overflow-hidden">
      <div className="p-3 flex items-center gap-3">
        <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
          cam.status === 'online' ? 'bg-green-400 animate-pulse' : 'bg-gray-600'
        }`} />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-gray-200">{cam.name}</div>
          <div className="text-xs text-gray-500 truncate">{cam.id} · {cam.zone || '구역 미지정'} · {cam.source}</div>
        </div>
        <div className="text-xs text-gray-600 font-mono whitespace-nowrap">
          H {cam.conf_helmet} / V {cam.conf_vest}
        </div>
        {canEdit && (
          <div className="flex items-center gap-1.5">
            <button
              className={`text-xs px-2 py-1 rounded border transition-colors ${
                editing ? 'border-blue-600 text-blue-400' : 'border-gray-600 text-gray-400 hover:border-gray-400 hover:text-gray-200'
              }`}
              onClick={() => setEditing(!editing)}
            >
              편집
            </button>
            <button
              className={`text-xs px-2 py-1 rounded border ${
                cam.status === 'online'
                  ? 'border-yellow-700 text-yellow-400 hover:bg-yellow-900/30'
                  : 'border-green-700 text-green-400 hover:bg-green-900/30'
              }`}
              onClick={handleToggle}
            >
              {cam.status === 'online' ? '중지' : '시작'}
            </button>
            <button className="text-xs text-red-400 hover:text-red-300 px-1" onClick={handleDelete}>삭제</button>
          </div>
        )}
      </div>

      {editing && (
        <div className="border-t border-gray-700 p-3 bg-gray-900/50 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">이름</label>
              <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <label className="label">구역</label>
              <input className="input" value={form.zone} onChange={(e) => setForm({ ...form, zone: e.target.value })} />
            </div>
            <div className="col-span-2">
              <label className="label">소스 (RTSP URL / 카메라 인덱스 / 파일 경로)</label>
              <input className="input" value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} />
            </div>
            <div>
              <label className="label">헬멧 임계값</label>
              <input type="number" step="0.05" min="0.1" max="1" className="input"
                value={form.conf_helmet} onChange={(e) => setForm({ ...form, conf_helmet: parseFloat(e.target.value) })} />
            </div>
            <div>
              <label className="label">조끼 임계값</label>
              <input type="number" step="0.05" min="0.1" max="1" className="input"
                value={form.conf_vest} onChange={(e) => setForm({ ...form, conf_vest: parseFloat(e.target.value) })} />
            </div>
          </div>
          <div className="flex gap-2">
            <button className="btn-primary text-xs" onClick={handleSave} disabled={saving}>
              {saving ? '저장 중...' : '저장'}
            </button>
            <button className="btn-ghost text-xs" onClick={() => setEditing(false)}>취소</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Cameras settings ──────────────────────────────────────────────────────────
function CamerasSettings() {
  const [cameras, setCameras] = useState<Camera[]>([])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ id: '', ...CAM_FORM_DEFAULT })
  const [loading, setLoading] = useState(false)
  const { user } = useAuthStore()
  const { setCameras: setGlobalCameras } = useCameraStore()
  const canEdit = user?.role === 'site_manager' || user?.role === 'admin'
  const { show, el: toastEl } = useToast()

  const load = async () => {
    const cams = await camerasApi.list().catch(() => null)
    if (!cams) return
    setCameras(cams)
    setGlobalCameras(cams)
  }
  useEffect(() => { load() }, [])

  async function handleCreate() {
    setLoading(true)
    try {
      await camerasApi.create(form)
      setShowForm(false)
      setForm({ id: '', ...CAM_FORM_DEFAULT })
      load()
      show('카메라가 추가되었습니다.')
    } catch (e: any) { alert(e.message) } finally { setLoading(false) }
  }

  return (
    <div className="p-6 space-y-4">
      {toastEl}
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">카메라 목록 <span className="text-gray-500 font-normal text-sm ml-1">{cameras.length}대</span></h2>
        {canEdit && (
          <button className="btn-primary" onClick={() => setShowForm(!showForm)}>+ 카메라 추가</button>
        )}
      </div>

      {showForm && (
        <div className="card p-4 space-y-3">
          <h3 className="text-sm font-semibold">새 카메라</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">카메라 ID *</label>
              <input className="input" value={form.id} onChange={(e) => setForm({ ...form, id: e.target.value })} placeholder="cam-01" />
            </div>
            <div>
              <label className="label">이름 *</label>
              <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="정문 입구" />
            </div>
            <div>
              <label className="label">구역</label>
              <input className="input" value={form.zone} onChange={(e) => setForm({ ...form, zone: e.target.value })} placeholder="A구역" />
            </div>
            <div>
              <label className="label">소스 (RTSP / 인덱스 / 파일 경로)</label>
              <input className="input" value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} placeholder="rtsp://... 또는 0" />
            </div>
            <div>
              <label className="label">헬멧 임계값</label>
              <input type="number" step="0.05" min="0.1" max="1" className="input"
                value={form.conf_helmet} onChange={(e) => setForm({ ...form, conf_helmet: parseFloat(e.target.value) })} />
            </div>
            <div>
              <label className="label">조끼 임계값</label>
              <input type="number" step="0.05" min="0.1" max="1" className="input"
                value={form.conf_vest} onChange={(e) => setForm({ ...form, conf_vest: parseFloat(e.target.value) })} />
            </div>
          </div>
          <div className="flex gap-2">
            <button className="btn-primary" onClick={handleCreate} disabled={loading || !form.id || !form.name}>
              {loading ? '추가 중...' : '추가'}
            </button>
            <button className="btn-ghost" onClick={() => setShowForm(false)}>취소</button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {cameras.map((cam) => (
          <CameraRow key={cam.id} cam={cam} canEdit={canEdit} onRefresh={load} onToast={show} />
        ))}
        {cameras.length === 0 && (
          <div className="text-center text-gray-600 py-8">등록된 카메라가 없습니다.</div>
        )}
      </div>
    </div>
  )
}

// ── Alert rule row ────────────────────────────────────────────────────────────
const VIOLATION_LABEL: Record<string, string> = {
  any: '모든 위반', no_helmet: '헬멧 미착용', no_vest: '조끼 미착용', no_helmet_no_vest: '헬멧+조끼 미착용',
}

function AlertRuleRow({ rule, canEdit, onRefresh, onToast }: {
  rule: AlertRule; canEdit: boolean; onRefresh: () => void; onToast: (m: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({
    name: rule.name, violation_type: rule.violation_type,
    min_duration_seconds: rule.min_duration_seconds, escalation_minutes: rule.escalation_minutes,
    channels: rule.channels, cameras: rule.cameras,
  })

  async function handleToggle() {
    try {
      await alertRulesApi.update(rule.id, { is_active: !rule.is_active })
      onRefresh()
    } catch (e: any) { alert(e.message) }
  }

  async function handleSave() {
    try {
      await alertRulesApi.update(rule.id, form)
      setEditing(false)
      onRefresh()
      onToast('저장되었습니다.')
    } catch (e: any) { alert(e.message) }
  }

  async function handleDelete() {
    if (!confirm('이 알림 규칙을 삭제하시겠습니까?')) return
    await alertRulesApi.delete(rule.id)
    onRefresh()
  }

  return (
    <div className="card overflow-hidden">
      <div className="p-3 flex items-start gap-3">
        <div className="mt-0.5">
          <Toggle checked={rule.is_active} onChange={handleToggle} />
        </div>
        <div className="flex-1 min-w-0">
          <div className={`text-sm font-semibold ${rule.is_active ? 'text-gray-200' : 'text-gray-500'}`}>{rule.name}</div>
          <div className="text-xs text-gray-500 mt-0.5">
            {VIOLATION_LABEL[rule.violation_type] ?? rule.violation_type}
            {' · '}최소 {rule.min_duration_seconds}초
            {' · '}에스컬레이션 {rule.escalation_minutes}분
          </div>
          <div className="flex gap-1 mt-1 flex-wrap">
            {rule.channels.split(',').filter(Boolean).map((ch) => (
              <span key={ch} className="text-[11px] bg-gray-800 border border-gray-700 px-1.5 py-0.5 rounded text-gray-400">
                {CHANNELS.find((c) => c.value === ch.trim())?.label ?? ch}
              </span>
            ))}
            {rule.cameras && (
              <span className="text-[11px] text-gray-600">카메라: {rule.cameras}</span>
            )}
          </div>
        </div>
        {canEdit && (
          <div className="flex items-center gap-1.5">
            <button
              className={`text-xs px-2 py-1 rounded border transition-colors ${
                editing ? 'border-blue-600 text-blue-400' : 'border-gray-600 text-gray-400 hover:border-gray-400 hover:text-gray-200'
              }`}
              onClick={() => setEditing(!editing)}
            >편집</button>
            <button className="text-xs text-red-400 hover:text-red-300 px-1" onClick={handleDelete}>삭제</button>
          </div>
        )}
      </div>

      {editing && (
        <div className="border-t border-gray-700 p-3 bg-gray-900/50 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">규칙 이름</label>
              <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <label className="label">위반 유형</label>
              <select className="input" value={form.violation_type} onChange={(e) => setForm({ ...form, violation_type: e.target.value })}>
                <option value="any">모든 위반</option>
                <option value="no_helmet">헬멧 미착용</option>
                <option value="no_vest">조끼 미착용</option>
                <option value="no_helmet_no_vest">헬멧+조끼 미착용</option>
              </select>
            </div>
            <div>
              <label className="label">최소 지속 시간 (초)</label>
              <input type="number" min="1" className="input"
                value={form.min_duration_seconds} onChange={(e) => setForm({ ...form, min_duration_seconds: parseInt(e.target.value) })} />
            </div>
            <div>
              <label className="label">에스컬레이션 (분)</label>
              <input type="number" min="1" className="input"
                value={form.escalation_minutes} onChange={(e) => setForm({ ...form, escalation_minutes: parseInt(e.target.value) })} />
            </div>
            <div className="col-span-2">
              <label className="label">알림 채널</label>
              <ChannelCheckboxes value={form.channels} onChange={(v) => setForm({ ...form, channels: v })} />
            </div>
            <div className="col-span-2">
              <label className="label">적용 카메라 ID (쉼표 구분, 빈 값 = 전체)</label>
              <input className="input" value={form.cameras} onChange={(e) => setForm({ ...form, cameras: e.target.value })} placeholder="cam-01,cam-02" />
            </div>
          </div>
          <div className="flex gap-2">
            <button className="btn-primary text-xs" onClick={handleSave}>저장</button>
            <button className="btn-ghost text-xs" onClick={() => setEditing(false)}>취소</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Alert rules settings ──────────────────────────────────────────────────────
function AlertsSettings() {
  const [rules, setRules] = useState<AlertRule[]>([])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({
    name: '', violation_type: 'any', min_duration_seconds: 3,
    cameras: '', channels: 'in_app', escalation_minutes: 10,
  })
  const { user } = useAuthStore()
  const canEdit = user?.role === 'site_manager' || user?.role === 'admin'
  const { show, el: toastEl } = useToast()

  const load = () => alertRulesApi.list().then(setRules).catch(() => {})
  useEffect(() => { load() }, [])

  async function handleCreate() {
    try {
      await alertRulesApi.create(form)
      setShowForm(false)
      setForm({ name: '', violation_type: 'any', min_duration_seconds: 3, cameras: '', channels: 'in_app', escalation_minutes: 10 })
      load()
      show('규칙이 추가되었습니다.')
    } catch (e: any) { alert(e.message) }
  }

  return (
    <div className="p-6 space-y-4">
      {toastEl}
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">알림 규칙</h2>
        {canEdit && <button className="btn-primary" onClick={() => setShowForm(!showForm)}>+ 규칙 추가</button>}
      </div>

      {showForm && (
        <div className="card p-4 space-y-3">
          <h3 className="text-sm font-semibold">새 알림 규칙</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">규칙 이름</label>
              <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <label className="label">위반 유형</label>
              <select className="input" value={form.violation_type} onChange={(e) => setForm({ ...form, violation_type: e.target.value })}>
                <option value="any">모든 위반</option>
                <option value="no_helmet">헬멧 미착용</option>
                <option value="no_vest">조끼 미착용</option>
                <option value="no_helmet_no_vest">헬멧+조끼 미착용</option>
              </select>
            </div>
            <div>
              <label className="label">최소 지속 시간 (초)</label>
              <input type="number" min="1" className="input"
                value={form.min_duration_seconds} onChange={(e) => setForm({ ...form, min_duration_seconds: parseInt(e.target.value) })} />
            </div>
            <div>
              <label className="label">에스컬레이션 (분)</label>
              <input type="number" min="1" className="input"
                value={form.escalation_minutes} onChange={(e) => setForm({ ...form, escalation_minutes: parseInt(e.target.value) })} />
            </div>
            <div className="col-span-2">
              <label className="label">알림 채널</label>
              <ChannelCheckboxes value={form.channels} onChange={(v) => setForm({ ...form, channels: v })} />
            </div>
            <div className="col-span-2">
              <label className="label">적용 카메라 ID (쉼표 구분, 빈 값 = 전체)</label>
              <input className="input" value={form.cameras} onChange={(e) => setForm({ ...form, cameras: e.target.value })} placeholder="cam-01,cam-02" />
            </div>
          </div>
          <div className="flex gap-2">
            <button className="btn-primary" onClick={handleCreate} disabled={!form.name}>추가</button>
            <button className="btn-ghost" onClick={() => setShowForm(false)}>취소</button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {rules.map((r) => (
          <AlertRuleRow key={r.id} rule={r} canEdit={canEdit} onRefresh={load} onToast={show} />
        ))}
        {rules.length === 0 && <div className="text-center text-gray-600 py-8">등록된 알림 규칙이 없습니다.</div>}
      </div>
    </div>
  )
}

// ── Users settings ────────────────────────────────────────────────────────────
const ROLE_LABEL: Record<string, string> = {
  viewer: '뷰어', safety_officer: '안전담당자', site_manager: '현장관리자', admin: '관리자',
}

function UserRow({ u, currentUserId, onRefresh, onToast }: {
  u: User; currentUserId: number; onRefresh: () => void; onToast: (m: string) => void
}) {
  const isSelf = u.id === currentUserId
  const [role, setRole] = useState<UserRole>(u.role)
  const [dirty, setDirty] = useState(false)

  async function handleToggleActive() {
    if (isSelf) return
    try {
      await usersApi.update(u.id, { is_active: !u.is_active })
      onRefresh()
    } catch (e: any) { alert(e.message) }
  }

  async function handleRoleSave() {
    try {
      await usersApi.update(u.id, { role })
      setDirty(false)
      onRefresh()
      onToast('역할이 변경되었습니다.')
    } catch (e: any) { alert(e.message) }
  }

  async function handleDelete() {
    if (isSelf) return
    if (!confirm(`사용자 "${u.name}"을 삭제하시겠습니까?`)) return
    await usersApi.delete(u.id)
    onRefresh()
  }

  return (
    <div className={`card p-3 flex items-center gap-3 ${!u.is_active ? 'opacity-50' : ''}`}>
      <div className={`w-2 h-2 rounded-full flex-shrink-0 ${u.is_active ? 'bg-green-400' : 'bg-gray-600'}`} />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-gray-200">
          {u.name}
          {isSelf && <span className="ml-2 text-xs text-blue-400">(나)</span>}
        </div>
        <div className="text-xs text-gray-500">{u.email}</div>
      </div>
      <div className="flex items-center gap-2">
        <select
          className="input py-0.5 text-xs"
          value={role}
          disabled={isSelf}
          onChange={(e) => { setRole(e.target.value as UserRole); setDirty(true) }}
        >
          <option value="viewer">뷰어</option>
          <option value="safety_officer">안전담당자</option>
          <option value="site_manager">현장관리자</option>
          <option value="admin">관리자</option>
        </select>
        {dirty && (
          <button className="text-xs btn-primary py-0.5 px-2" onClick={handleRoleSave}>저장</button>
        )}
      </div>
      {!isSelf && (
        <>
          <Toggle checked={u.is_active} onChange={handleToggleActive} />
          <button className="text-xs text-red-400 hover:text-red-300 px-1" onClick={handleDelete}>삭제</button>
        </>
      )}
    </div>
  )
}

function UsersSettings() {
  const [users, setUsers] = useState<User[]>([])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ email: '', name: '', password: '', role: 'safety_officer' })
  const { user: currentUser } = useAuthStore()
  const { show, el: toastEl } = useToast()

  const load = () => usersApi.list().then(setUsers).catch(() => {})
  useEffect(() => { load() }, [])

  async function handleCreate() {
    try {
      await usersApi.create(form)
      setShowForm(false)
      setForm({ email: '', name: '', password: '', role: 'safety_officer' })
      load()
      show('사용자가 추가되었습니다.')
    } catch (e: any) { alert(e.message) }
  }

  return (
    <div className="p-6 space-y-4">
      {toastEl}
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">사용자 관리 <span className="text-gray-500 font-normal text-sm ml-1">{users.length}명</span></h2>
        <button className="btn-primary" onClick={() => setShowForm(!showForm)}>+ 사용자 추가</button>
      </div>

      {showForm && (
        <div className="card p-4 space-y-3">
          <h3 className="text-sm font-semibold">새 사용자</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">이름</label>
              <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <label className="label">이메일</label>
              <input type="email" className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div>
              <label className="label">비밀번호</label>
              <input type="password" className="input" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </div>
            <div>
              <label className="label">역할</label>
              <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                <option value="viewer">뷰어</option>
                <option value="safety_officer">안전담당자</option>
                <option value="site_manager">현장관리자</option>
                <option value="admin">관리자</option>
              </select>
            </div>
          </div>
          <div className="flex gap-2">
            <button className="btn-primary" onClick={handleCreate} disabled={!form.name || !form.email || !form.password}>추가</button>
            <button className="btn-ghost" onClick={() => setShowForm(false)}>취소</button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {users.map((u) => (
          <UserRow key={u.id} u={u} currentUserId={currentUser?.id ?? -1} onRefresh={load} onToast={show} />
        ))}
        {users.length === 0 && <div className="text-center text-gray-600 py-8">사용자가 없습니다.</div>}
      </div>
    </div>
  )
}

// ── System settings ───────────────────────────────────────────────────────────
function SystemSettings() {
  const [info, setInfo] = useState<SystemInfo | null>(null)
  const [inferValue, setInferValue] = useState(1)
  const [isAuto, setIsAuto] = useState(true)
  const [streamFps, setStreamFps] = useState(10)
  const [saving, setSaving] = useState(false)
  const { ttsEnabled, setTtsEnabled } = useSettingsStore()
  const { show, el: toastEl } = useToast()

  const load = async () => {
    const s = await systemApi.get().catch(() => null)
    if (!s) return
    setInfo(s)
    setIsAuto(s.mode === 'auto')
    setInferValue(s.infer_every_n_override ?? s.infer_every_n_effective)
    setStreamFps(s.stream_fps_effective)
  }
  useEffect(() => { load() }, [])

  async function handleSave() {
    setSaving(true)
    try {
      const patch = isAuto
        ? { auto: true, stream_fps: streamFps }
        : { infer_every_n: inferValue, stream_fps: streamFps }
      const s = await systemApi.patch(patch)
      setInfo(s)
      show('적용되었습니다.')
    } finally { setSaving(false) }
  }

  return (
    <div className="p-6 space-y-6 max-w-lg">
      {toastEl}
      <h2 className="font-semibold">시스템 설정</h2>

      <div className="card p-4 space-y-4">
        <h3 className="text-sm font-semibold text-gray-300">YOLO 추론 빈도</h3>
        <div className="flex items-center gap-3">
          <Toggle checked={isAuto} onChange={setIsAuto} />
          <span className="text-sm text-gray-300">자동 (GPU 부하 기반)</span>
        </div>
        {!isAuto && (
          <div className="space-y-2">
            <label className="label">N 프레임마다 추론 1회 (1 = 매 프레임)</label>
            <div className="flex items-center gap-3">
              <input
                type="range" min={1} max={30} step={1}
                value={inferValue}
                onChange={(e) => setInferValue(Number(e.target.value))}
                className="flex-1 accent-blue-500"
              />
              <span className="text-sm font-mono w-6 text-center text-gray-200">{inferValue}</span>
            </div>
            <p className="text-xs text-gray-500">
              {streamFps}fps 스트림 기준 — {inferValue === 1 ? '매 프레임 추론' : `${inferValue}프레임마다 추론`}
              {inferValue > 1 && ` (실효 ${(streamFps / inferValue).toFixed(1)} fps)`}
            </p>
          </div>
        )}
      </div>

      <div className="card p-4 space-y-4">
        <h3 className="text-sm font-semibold text-gray-300">스트림 FPS</h3>
        <div className="space-y-2">
          <label className="label">프론트엔드로 전송할 최대 프레임 수 (fps)</label>
          <div className="flex items-center gap-3">
            <input
              type="range" min={1} max={30} step={1}
              value={streamFps}
              onChange={(e) => setStreamFps(Number(e.target.value))}
              className="flex-1 accent-blue-500"
            />
            <span className="text-sm font-mono w-8 text-center text-gray-200">{streamFps}</span>
          </div>
          <p className="text-xs text-gray-500">
            {streamFps <= 5 ? '낮음 — 네트워크 부하 최소' :
             streamFps <= 15 ? '보통 — 권장 범위' :
             '높음 — GPU/네트워크 여유가 있을 때'}
            {info && ` (기본값: ${info.stream_fps_default} fps)`}
          </p>
        </div>
      </div>

      <button className="btn-primary text-sm" onClick={handleSave} disabled={saving}>
        {saving ? '적용 중...' : '적용'}
      </button>

      {info && (
        <div className="card p-4 space-y-1.5 text-xs">
          <div className="flex justify-between">
            <span className="text-gray-500">추론 모드</span>
            <span className="text-gray-300">{info.mode === 'auto' ? '자동' : '수동'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">실효 skip</span>
            <span className="text-gray-300">{info.infer_every_n_effective} 프레임마다</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">스트림 FPS</span>
            <span className="text-gray-300">{info.stream_fps_effective} fps</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">GPU 측정값</span>
            <span className={`font-mono ${info.gpu_ms_per_frame > 80 ? 'text-red-400' : info.gpu_ms_per_frame > 40 ? 'text-yellow-400' : 'text-green-400'}`}>
              {info.gpu_ms_per_frame} ms/프레임
            </span>
          </div>
        </div>
      )}

      <div className="card p-4 space-y-3">
        <h3 className="text-sm font-semibold text-gray-300">음성 안내방송 (TTS)</h3>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-gray-300">위반 감지 시 음성 안내</div>
            <div className="text-xs text-gray-500 mt-0.5">브라우저 Web Speech API 사용 (한국어)</div>
          </div>
          <Toggle checked={ttsEnabled} onChange={setTtsEnabled} />
        </div>
        {ttsEnabled && !window.speechSynthesis && (
          <p className="text-xs text-yellow-400">이 브라우저는 TTS를 지원하지 않습니다.</p>
        )}
      </div>
    </div>
  )
}

// ── My Account ────────────────────────────────────────────────────────────────
function MyAccount() {
  const { user, setUser } = useAuthStore()
  const [pw, setPw] = useState({ old: '', next: '', confirm: '' })
  const [saving, setSaving] = useState(false)
  const [pwError, setPwError] = useState<string | null>(null)
  const [editingName, setEditingName] = useState(false)
  const [nameVal, setNameVal] = useState(user?.name ?? '')
  const [nameSaving, setNameSaving] = useState(false)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const { show, el: toastEl } = useToast()

  async function handleChangePw() {
    if (pw.next !== pw.confirm) { setPwError('새 비밀번호가 일치하지 않습니다.'); return }
    if (pw.next.length < 6) { setPwError('비밀번호는 6자 이상이어야 합니다.'); return }
    setPwError(null)
    setSaving(true)
    try {
      await authApi.changePassword(pw.old, pw.next)
      setPw({ old: '', next: '', confirm: '' })
      show('비밀번호가 변경되었습니다.')
    } catch (e: any) {
      setPwError(e.message)
    } finally { setSaving(false) }
  }

  function startEditName() {
    setNameVal(user?.name ?? '')
    setEditingName(true)
    setTimeout(() => nameInputRef.current?.select(), 0)
  }

  async function handleSaveName() {
    if (!nameVal.trim()) return
    setNameSaving(true)
    try {
      const updated = await authApi.updateProfile(nameVal.trim())
      setUser(updated)
      setEditingName(false)
      show('이름이 변경되었습니다.')
    } catch (e: any) {
      show(e.message)
    } finally { setNameSaving(false) }
  }

  return (
    <div className="p-6 space-y-6 max-w-md">
      {toastEl}
      <h2 className="font-semibold">내 계정</h2>

      {/* Profile info */}
      <div className="card p-4 space-y-2">
        <h3 className="text-sm font-semibold text-gray-300 mb-3">프로필</h3>
        <div className="flex items-center justify-between text-sm min-h-[2rem]">
          <span className="text-gray-500 flex-shrink-0">이름</span>
          {editingName ? (
            <div className="flex items-center gap-2 ml-4 flex-1 justify-end">
              <input
                ref={nameInputRef}
                className="input py-0.5 text-sm w-40"
                value={nameVal}
                onChange={(e) => setNameVal(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSaveName(); if (e.key === 'Escape') setEditingName(false) }}
              />
              <button className="btn-primary text-xs py-0.5 px-2" onClick={handleSaveName} disabled={nameSaving || !nameVal.trim()}>
                {nameSaving ? '저장...' : '저장'}
              </button>
              <button className="btn-ghost text-xs py-0.5 px-2" onClick={() => setEditingName(false)}>취소</button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-gray-200">{user?.name}</span>
              <button className="text-xs text-gray-500 hover:text-gray-300 underline underline-offset-2" onClick={startEditName}>
                수정
              </button>
            </div>
          )}
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">이메일</span>
          <span className="text-gray-200">{user?.email}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">역할</span>
          <span className="text-gray-200">{ROLE_LABEL[user?.role ?? ''] ?? user?.role}</span>
        </div>
      </div>

      {/* Change password */}
      <div className="card p-4 space-y-3">
        <h3 className="text-sm font-semibold text-gray-300">비밀번호 변경</h3>
        <div>
          <label className="label">현재 비밀번호</label>
          <input type="password" className="input" value={pw.old} onChange={(e) => setPw({ ...pw, old: e.target.value })} />
        </div>
        <div>
          <label className="label">새 비밀번호</label>
          <input type="password" className="input" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
        </div>
        <div>
          <label className="label">새 비밀번호 확인</label>
          <input type="password" className="input" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
        </div>
        {pwError && <p className="text-xs text-red-400">{pwError}</p>}
        <button
          className="btn-primary text-sm"
          onClick={handleChangePw}
          disabled={saving || !pw.old || !pw.next || !pw.confirm}
        >
          {saving ? '변경 중...' : '변경'}
        </button>
      </div>
    </div>
  )
}

// ── Main Settings page ────────────────────────────────────────────────────────
export default function Settings() {
  const navigate = useNavigate()
  useEffect(() => {
    navigate('/settings/cameras', { replace: true })
  }, [])

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-3 border-b border-gray-800">
        <h1 className="text-lg font-bold text-gray-100">설정</h1>
      </div>
      <SettingsNav />
      <div className="flex-1 overflow-y-auto">
        <Routes>
          <Route path="cameras" element={<CamerasSettings />} />
          <Route path="alerts" element={<AlertsSettings />} />
          <Route path="system" element={<SystemSettings />} />
          <Route path="users" element={<UsersSettings />} />
          <Route path="account" element={<MyAccount />} />
        </Routes>
      </div>
    </div>
  )
}
