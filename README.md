# PPE Safety Detection AI

건설 현장 등 산업 현장에서 **안전모(헬멧)** 와 **반사조끼** 착용 여부를 실시간 감지하는 AI 기반 안전 모니터링 시스템.
YOLO 이중 모델 파이프라인 + FastAPI 백엔드 + React 대시보드로 구성된 풀스택 솔루션.

![PPE Detection Demo](output.gif)

## 주요 기능

### AI 감지 엔진
- **이중 모델 파이프라인** — `yolo12n`(사람 감지) + `best`(헬멧/조끼 감지)를 순차 실행
- **해부학적 영역 매칭** — 머리(상단 26%)에 헬멧, 몸통(중간 52%)에 조끼를 매핑하여 PPE-사람 연결
- **IoU 트래커** — 프레임 간 사람 ID 추적 (IoU ≥ 0.35, max_age 5프레임)
- **시간적 스무딩** — 7프레임 슬라이딩 윈도우 다수결로 오탐 최소화
- **TensorRT 추론** — `.engine` 파일 우선 로드 (`.pt` 폴백), GPU 추론 가속
- **배치 추론** — 최대 8프레임을 하나의 GPU 호출로 처리, 동적 프레임 스킵

### 웹 대시보드
- **실시간 모니터링** — WebSocket 기반 카메라 스트리밍 (JPEG + 감지 JSON)
- **패널 레이아웃** — 드래그로 크기 조절 가능한 분할 패널 (1x1 ~ 4x4)
- **위반 이력** — 카메라/유형/상태별 필터링, 스냅샷 저장
- **통계 보고서** — 준수율 트렌드, 시간대별 히트맵, 카메라별 위반 현황, CSV/JSON 내보내기
- **알림 시스템** — 인앱 알림 + TTS 음성 경고 (한국어)
- **사용자 관리** — 4단계 권한 (뷰어, 안전담당자, 현장관리자, 관리자)

### 백엔드 API
- **카메라 관리** — 추가/수정/삭제, 개별 감지 임계값 설정
- **위반 관리** — 자동 기록, 확인 처리, 스냅샷 다운로드
- **시스템 튜닝** — 추론 빈도, 스트리밍 FPS 실시간 조절
- **보고서 내보내기** — 기간별 CSV/JSON 다운로드

## 기술 스택

| 영역 | 기술 |
|------|------|
| AI 모델 | YOLOv12 + TensorRT (기본) / PyTorch·ONNX 폴백 |
| 백엔드 | FastAPI + SQLAlchemy (async) + SQLite |
| 프론트엔드 | React 18 + TypeScript + Zustand + Tailwind CSS |
| 실시간 통신 | WebSocket |
| 차트 | Recharts |
| 인증 | JWT (python-jose) + bcrypt |

## 프로젝트 구조

```
ppe-safety-detection-ai/
├── workplace_safety_monitor.py    # AI 감지 파이프라인 (사람/PPE 감지, 추적, 스무딩)
├── best.engine (+ .pt 폴백)       # PPE 감지 모델 (헬멧, 반사조끼) — TensorRT
├── yolo12n.engine (+ .pt 폴백)    # 사람 감지 모델 — TensorRT
│
├── backend/
│   ├── main.py                    # FastAPI 앱 (라이프사이클, 시드 데이터, 시스템 설정)
│   ├── monitor_bridge.py          # 카메라 워커, 배치 추론 디스패처, WebSocket 브로드캐스트
│   ├── database.py                # SQLAlchemy async 엔진 (SQLite)
│   ├── models.py                  # ORM 모델 (User, Camera, Violation, AlertRule)
│   ├── auth.py                    # JWT 인증, 비밀번호 해싱
│   ├── schemas.py                 # Pydantic 스키마
│   └── routers/                   # API 엔드포인트
│       ├── auth.py                #   로그인, 프로필, 비밀번호 변경
│       ├── cameras.py             #   카메라 CRUD, 시작/중지
│       ├── violations.py          #   위반 이력, 확인 처리, 스냅샷
│       ├── stats.py               #   KPI, 타임라인, 히트맵, 내보내기
│       ├── users.py               #   사용자 CRUD (관리자)
│       ├── alert_rules.py         #   알림 규칙 CRUD
│       └── ws.py                  #   WebSocket 스트리밍
│
├── frontend/
│   ├── src/
│   │   ├── pages/
│   │   │   ├── Dashboard.tsx      # 메인 모니터링 (패널 레이아웃 + KPI)
│   │   │   ├── CameraView.tsx     # 카메라 전체화면 + 감지 오버레이
│   │   │   ├── Violations.tsx     # 위반 이력 테이블
│   │   │   ├── Reports.tsx        # 통계 차트 + 내보내기
│   │   │   └── Settings.tsx       # 카메라/사용자/알림/시스템 설정
│   │   ├── components/
│   │   │   ├── PanelTree.tsx      # 분할 패널 레이아웃 (드래그 리사이즈)
│   │   │   ├── CameraTile.tsx     # 카메라 타일 (실시간 스트림 + 감지 표시)
│   │   │   └── ...
│   │   └── store/
│   │       ├── index.ts           # Zustand 스토어 (인증, 카메라, 알림, 프레임, 설정)
│   │       └── layout.ts          # 패널 레이아웃 상태
│   └── package.json
│
├── dataset/                        # 학습 데이터 (10,500장, YOLO 형식)
│   └── safety-Helmet-Reflective-Jacket/
├── start.bat                       # 원클릭 실행 스크립트
└── requirements.txt
```

## 감지 파이프라인

```
카메라/비디오/RTSP 입력
  │
  ▼
[yolo12n.engine] 사람 감지 (conf ≥ 0.45)
  │
  ▼
[best.engine] 헬멧/조끼 감지 (헬멧 ≥ 0.65, 조끼 ≥ 0.70)
  │
  ▼
해부학적 영역 매핑 → PPE-사람 매칭 (IoU + 포함율 가중 스코어)
  │
  ▼
IoU 트래커 → 시간적 스무딩 (7프레임 다수결)
  │
  ▼
결과: 초록(안전) / 주황(부분) / 빨강(미착용)
```

## 설치 및 실행

### 요구사항
- Python 3.8+
- Node.js 18+
- NVIDIA GPU + CUDA + TensorRT (`.engine` 모델 사용, `.pt` 폴백 가능)

### 설치

```bash
git clone https://github.com/JunePark2018/ppe-monitor.git
cd ppe-monitor

# 백엔드 의존성
pip install -r backend/requirements.txt

# 프론트엔드 의존성
cd frontend && npm install && cd ..
```

### 실행

**원클릭 (Windows):**
```bash
start.bat
```

**수동 실행:**
```bash
# 백엔드 (포트 8000)
uvicorn backend.main:app --reload --port 8000

# 프론트엔드 (포트 5173)
cd frontend && npm run dev
```

브라우저에서 `http://localhost:5173` 접속.

### 기본 계정

| 역할 | 이메일 | 비밀번호 |
|------|--------|----------|
| 관리자 | admin@ppe.local | admin1234 |
| 안전담당자 | safety@ppe.local | safety1234 |

### CLI 단독 실행 (웹 없이)

```bash
python workplace_safety_monitor.py \
  --source 0 \
  --ppe-weights best.pt \
  --person-weights yolo12n.pt \
  --save-vis output/
```

## API 엔드포인트

| 메서드 | 경로 | 설명 |
|--------|------|------|
| POST | `/api/auth/login` | 로그인 (JWT 토큰 발급) |
| GET | `/api/cameras` | 카메라 목록 |
| POST | `/api/cameras/{id}/start` | 스트리밍 시작 |
| WS | `/ws/cameras/{id}/stream` | 실시간 영상 + 감지 데이터 |
| GET | `/api/violations` | 위반 이력 (필터링) |
| PUT | `/api/violations/{id}/acknowledge` | 위반 확인 처리 |
| GET | `/api/stats/summary` | KPI 요약 |
| GET | `/api/stats/heatmap` | 구역×시간 히트맵 |
| GET | `/api/reports/export?format=csv` | 보고서 내보내기 |
| PATCH | `/api/system` | 추론 빈도 / 스트림 FPS 조절 |

## 사용자 권한

| 기능 | 뷰어 | 안전담당자 | 현장관리자 | 관리자 |
|------|:----:|:---------:|:---------:|:-----:|
| 라이브 모니터링 | O | O | O | O |
| 위반 확인/처리 | | O | O | O |
| 보고서 내보내기 | | O | O | O |
| 카메라 설정 | | | O | O |
| 사용자 관리 | | | | O |

## 데이터셋

- **출처**: [Kaggle - Construction Site Safety](https://www.kaggle.com/datasets/snehilsanyal/construction-site-safety-image-dataset-roboflow) (Snehil Sanyal / Roboflow)
- **규모**: 10,500장 (Train 7,350 / Valid 1,575 / Test 1,575)
- **클래스**: Safety-Helmet (0), Reflective-Jacket (1)
- **형식**: YOLO (center_x, center_y, w, h 정규화)

## 라이선스

MIT License
