import { Fragment, useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { useNavigate } from 'react-router-dom'
import { useCameraStore } from '../store'
import { useLayoutStore, type LeafNode, type PanelNode, type SplitNode, type SplitDirection } from '../store/layout'
import CameraTile from './CameraTile'

// ── Context menu ──────────────────────────────────────────────────────────────

interface ContextMenuProps {
  x: number
  y: number
  hasCamera: boolean
  onSplit: (dir: SplitDirection) => void
  onAssign: () => void
  onRemove: () => void
  onDismiss: () => void
}

function ContextMenu({ x, y, hasCamera, onSplit, onAssign, onRemove, onDismiss }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })

  useLayoutEffect(() => {
    if (!ref.current) return
    const { offsetWidth: w, offsetHeight: h } = ref.current
    setPos({
      x: Math.min(x, window.innerWidth  - w - 8),
      y: Math.min(y, window.innerHeight - h - 8),
    })
  }, [x, y])

  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onDismiss()
    }
    document.addEventListener('mousedown', down, true)
    return () => document.removeEventListener('mousedown', down, true)
  }, [onDismiss])

  return createPortal(
    <div
      ref={ref}
      className="fixed z-50 bg-gray-900 border border-gray-600 rounded shadow-2xl py-1 text-sm min-w-[9rem]"
      style={{ left: pos.x, top: pos.y }}
    >
      <div className="px-3 py-1 text-xs text-gray-500 font-semibold">카메라 추가</div>
      <button className="w-full text-left px-3 py-1.5 hover:bg-gray-700 text-gray-200" onClick={() => onSplit('top')}>↑ 위</button>
      <button className="w-full text-left px-3 py-1.5 hover:bg-gray-700 text-gray-200" onClick={() => onSplit('bottom')}>↓ 아래</button>
      <button className="w-full text-left px-3 py-1.5 hover:bg-gray-700 text-gray-200" onClick={() => onSplit('left')}>← 왼쪽</button>
      <button className="w-full text-left px-3 py-1.5 hover:bg-gray-700 text-gray-200" onClick={() => onSplit('right')}>→ 오른쪽</button>
      <div className="border-t border-gray-700 my-1" />
      <button className="w-full text-left px-3 py-1.5 hover:bg-gray-700 text-gray-200" onClick={onAssign}>
        📷 {hasCamera ? '카메라 변경' : '카메라 지정'}
      </button>
      <div className="border-t border-gray-700 my-1" />
      <button className="w-full text-left px-3 py-1.5 hover:bg-red-900/40 text-red-400" onClick={onRemove}>
        ✕ 패널 닫기
      </button>
    </div>,
    document.body
  )
}

// ── Camera select modal ───────────────────────────────────────────────────────

function CameraSelectModal({
  onSelect,
  onDismiss,
}: {
  onSelect: (id: string | null) => void
  onDismiss: () => void
}) {
  const { cameras } = useCameraStore()
  const innerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (innerRef.current && !innerRef.current.contains(e.target as Node)) onDismiss()
    }
    document.addEventListener('mousedown', down, true)
    return () => document.removeEventListener('mousedown', down, true)
  }, [onDismiss])

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={(e) => e.stopPropagation()}>
      <div
        ref={innerRef}
        className="bg-gray-900 border border-gray-700 rounded-lg shadow-2xl w-72 max-h-96 flex flex-col"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
          <span className="text-sm font-semibold text-gray-200">카메라 선택</span>
          <button className="text-gray-500 hover:text-gray-300" onClick={onDismiss}>✕</button>
        </div>
        <div className="overflow-y-auto flex-1 p-2 space-y-0.5">
          <button
            className="w-full text-left px-3 py-2 text-sm text-gray-500 hover:bg-gray-800 rounded"
            onClick={() => onSelect(null)}
          >
            없음 (빈 슬롯)
          </button>
          {cameras.map((cam) => (
            <button
              key={cam.id}
              className="w-full text-left px-3 py-2 text-sm hover:bg-gray-800 rounded flex items-center gap-2"
              onClick={() => onSelect(cam.id)}
            >
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${cam.status === 'online' ? 'bg-green-400' : 'bg-gray-600'}`} />
              <span className="text-gray-200 truncate">{cam.name}</span>
              <span className="text-gray-600 text-xs ml-auto flex-shrink-0">{cam.id}</span>
            </button>
          ))}
          {cameras.length === 0 && (
            <p className="text-center text-gray-600 py-4 text-xs">등록된 카메라가 없습니다</p>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}

// ── Leaf (camera slot) ────────────────────────────────────────────────────────

function PanelLeaf({ node }: { node: LeafNode }) {
  const navigate = useNavigate()
  const { cameras } = useCameraStore()
  const { split, close, setCamera } = useLayoutStore()
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [selecting, setSelecting] = useState(false)

  const camera = cameras.find((c) => c.id === node.cameraId) ?? null

  const openMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY })
  }

  const handleClick = (e: React.MouseEvent) => {
    if (!camera && !e.shiftKey) setSelecting(true)
  }

  return (
    <div className="w-full h-full relative" onContextMenu={openMenu} onClick={handleClick}>
      {camera ? (
        <CameraTile
          camera={camera}
          selected={false}
          onClick={() => {}}
          onDoubleClick={() => navigate(`/cameras/${camera.id}`)}
        />
      ) : (
        <div className="w-full h-full bg-black flex flex-col items-center justify-center gap-2 cursor-pointer select-none">
          <span className="text-gray-800 text-4xl">+</span>
          <span className="text-gray-700 text-xs">클릭: 카메라 추가  ·  우클릭: 옵션</span>
        </div>
      )}

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          hasCamera={camera !== null}
          onSplit={(dir) => { split(node.id, dir); setMenu(null) }}
          onAssign={() => { setSelecting(true); setMenu(null) }}
          onRemove={() => { close(node.id); setMenu(null) }}
          onDismiss={() => setMenu(null)}
        />
      )}

      {selecting && (
        <CameraSelectModal
          onSelect={(id) => { setCamera(node.id, id); setSelecting(false) }}
          onDismiss={() => setSelecting(false)}
        />
      )}
    </div>
  )
}

// ── Split node ────────────────────────────────────────────────────────────────

const SNAP_THRESHOLD = 12 // % — below this size, show snap indicator

function PanelSplit({ node }: { node: SplitNode }) {
  const { setSizes, close } = useLayoutStore()
  const defaultSizes = node.children.map((_, i) => node.sizes[i] ?? 100 / node.children.length)

  // Refs — keep latest values accessible inside stable callbacks without re-creating them
  const childrenRef  = useRef(node.children); childrenRef.current  = node.children
  const nodeIdRef    = useRef(node.id);        nodeIdRef.current    = node.id
  const setSizesRef  = useRef(setSizes);       setSizesRef.current  = setSizes
  const closeRef     = useRef(close);          closeRef.current     = close
  const liveSizesRef = useRef(defaultSizes)
  const pendingClose = useRef<string | null>(null)

  // DOM refs for snap indicators — avoids any React state update during drag
  const snapBadgeRefs    = useRef<(HTMLDivElement | null)[]>([])
  const snapLineRefs     = useRef<(HTMLDivElement | null)[]>([])
  const normalLineRefs   = useRef<(HTMLDivElement | null)[]>([])

  // pointerup: persist sizes to store + close collapsed panel AFTER library finishes
  useEffect(() => {
    const handleUp = () => setTimeout(() => {
      setSizesRef.current(nodeIdRef.current, liveSizesRef.current)
      if (pendingClose.current) {
        closeRef.current(pendingClose.current)
        pendingClose.current = null
      }
    }, 0)
    window.addEventListener('pointerup', handleUp)
    return () => window.removeEventListener('pointerup', handleUp)
  }, []) // mount-only — refs give access to latest values

  // During drag: update DOM directly — NO React state changes (avoids re-render → drag reset)
  const handleLayoutChange = useCallback((layout: Record<string, number>) => {
    const children = childrenRef.current
    const sizes = children.map((c) => layout[c.id] ?? 100 / children.length)
    liveSizesRef.current = sizes

    for (let i = 0; i < children.length - 1; i++) {
      const snapping = sizes[i] < SNAP_THRESHOLD || sizes[i + 1] < SNAP_THRESHOLD
      const badge      = snapBadgeRefs.current[i]
      const snapLine   = snapLineRefs.current[i]
      const normalLine = normalLineRefs.current[i]
      if (badge)      badge.style.display      = snapping ? '' : 'none'
      if (snapLine)   snapLine.style.display   = snapping ? '' : 'none'
      if (normalLine) normalLine.style.display = snapping ? 'none' : ''
    }

    const idx = sizes.findIndex((s) => s < SNAP_THRESHOLD)
    pendingClose.current = idx >= 0 ? children[idx].id : null
  }, []) // stable — no deps needed

  const isHoriz = node.direction === 'horizontal'

  return (
    <Group
      key={node.id}
      orientation={node.direction}
      onLayoutChange={handleLayoutChange}
      style={{ height: '100%', width: '100%' }}
    >
      {node.children.map((child, i) => (
        <Fragment key={child.id}>
          <Panel
            id={child.id}
            defaultSize={defaultSizes[i]}
            minSize={0}
            style={{ overflow: 'hidden', height: '100%' }}
          >
            <PanelTreeNode node={child} />
          </Panel>

          {i < node.children.length - 1 && (
            <Separator
              tabIndex={-1}
              className={[
                'relative flex-shrink-0 flex items-center justify-center',
                'bg-transparent group',
                isHoriz ? 'w-3 cursor-col-resize' : 'h-3 cursor-row-resize',
              ].join(' ')}
            >
              {/* Snap badge — hidden until DOM update shows it */}
              <div
                ref={(el) => { snapBadgeRefs.current[i] = el }}
                style={{ display: 'none' }}
                className={[
                  'absolute z-20 pointer-events-none',
                  'bg-orange-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded',
                  'whitespace-nowrap shadow-lg',
                  isHoriz ? '-translate-y-4' : '-translate-x-6',
                ].join(' ')}
              >
                ⊟ 붙이기
              </div>
              {/* Normal line (hover/active colors via CSS) */}
              <div
                ref={(el) => { normalLineRefs.current[i] = el }}
                className={[
                  'transition-colors duration-75',
                  'bg-gray-700 group-hover:bg-blue-500 data-[resize-handle-active]:bg-blue-400',
                  isHoriz ? 'w-[3px] h-full' : 'h-[3px] w-full',
                ].join(' ')}
              />
              {/* Snap line — shown instead of normal line when snapping */}
              <div
                ref={(el) => { snapLineRefs.current[i] = el }}
                style={{ display: 'none' }}
                className={[
                  'bg-orange-400',
                  isHoriz ? 'w-[3px] h-full' : 'h-[3px] w-full',
                ].join(' ')}
              />
            </Separator>
          )}
        </Fragment>
      ))}
    </Group>
  )
}

// ── Root export ───────────────────────────────────────────────────────────────

export function PanelTreeNode({ node }: { node: PanelNode }) {
  if (node.type === 'leaf') return <PanelLeaf node={node} />
  return <PanelSplit node={node} />
}

export function PanelTreeRoot({ node }: { node: PanelNode }) {
  return <PanelTreeNode node={node} />
}
