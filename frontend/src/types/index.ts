// ── Auth ──────────────────────────────────────────────────────────────────────
export type UserRole = 'viewer' | 'safety_officer' | 'site_manager' | 'admin'

export interface User {
  id: number
  email: string
  name: string
  role: UserRole
  is_active: boolean
}

// ── Camera ────────────────────────────────────────────────────────────────────
export type CameraStatus = 'online' | 'offline' | 'error'

export interface ComplianceSummary {
  total_persons: number
  compliant: number
  partial: number
  non_compliant: number
  compliance_rate: number  // 0.0 – 1.0
}

export interface Camera {
  id: string
  name: string
  zone: string
  source: string
  status: CameraStatus
  conf_helmet: number
  conf_vest: number
  created_at: string
  current_summary: ComplianceSummary
}

// ── Detection / WebSocket frame ───────────────────────────────────────────────
export type ComplianceStatus = 'compliant' | 'partial' | 'non_compliant'

export interface Detection {
  track_id: number
  status: ComplianceStatus
  helmet: boolean
  vest: boolean
  bbox: [number, number, number, number]  // x1, y1, x2, y2
  confidence: number
}

export interface CameraFrame {
  frame_id: number
  camera_id: string
  timestamp: string
  jpeg_b64: string
  detections: Detection[]
  summary: ComplianceSummary
}

// ── Violation ─────────────────────────────────────────────────────────────────
export type ViolationType = 'no_helmet' | 'no_vest' | 'no_helmet_no_vest'
export type ViolationStatus = 'unacknowledged' | 'acknowledged'

export interface Violation {
  id: number
  camera_id: string
  camera_name: string
  zone: string
  track_id: number
  type: ViolationType
  started_at: string
  duration_seconds: number
  snapshot_path: string
  status: ViolationStatus
  acknowledged_by: string
  acknowledged_at: string | null
  note: string
}

// ── Stats ─────────────────────────────────────────────────────────────────────
export interface StatsSummary {
  compliance_rate: number
  total_violations: number
  total_violations_yesterday: number
  active_violations: number
  total_persons_today: number
  cameras_online: number
  cameras_total: number
}

export interface TimelinePoint {
  hour: string
  violation_count: number
}

// ── Alert Rule ────────────────────────────────────────────────────────────────
export interface AlertRule {
  id: number
  name: string
  violation_type: string
  min_duration_seconds: number
  cameras: string
  channels: string
  escalation_minutes: number
  is_active: boolean
}

// ── In-app alert (ephemeral, not persisted) ───────────────────────────────────
export interface AppAlert {
  id: string  // uuid-like
  camera_id: string
  camera_name: string
  track_id: number
  type: ViolationType
  timestamp: string
  acknowledged: boolean
}
