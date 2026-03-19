import { create } from 'zustand'

const uid = () => Math.random().toString(36).slice(2, 11)

export type LeafNode = { id: string; type: 'leaf'; cameraId: string | null }
export type SplitNode = {
  id: string
  type: 'split'
  direction: 'horizontal' | 'vertical'
  sizes: number[]
  children: PanelNode[]
}
export type PanelNode = LeafNode | SplitNode

export const makeLeaf = (cameraId: string | null = null): LeafNode => ({
  id: uid(), type: 'leaf', cameraId,
})

export const makeSplit = (
  direction: 'horizontal' | 'vertical',
  children: PanelNode[],
  sizes?: number[],
): SplitNode => ({
  id: uid(),
  type: 'split',
  direction,
  sizes: sizes ?? children.map(() => 100 / children.length),
  children,
})

export function collectCameraIds(node: PanelNode): string[] {
  if (node.type === 'leaf') return node.cameraId ? [node.cameraId] : []
  return node.children.flatMap(collectCameraIds)
}

// ── Tree helpers ──────────────────────────────────────────────────────────────

function findLeaf(root: PanelNode, id: string): LeafNode | null {
  if (root.id === id && root.type === 'leaf') return root
  if (root.type === 'split') {
    for (const c of root.children) {
      const f = findLeaf(c, id)
      if (f) return f
    }
  }
  return null
}

function replaceInTree(root: PanelNode, targetId: string, replacement: PanelNode | null): PanelNode {
  if (root.type === 'leaf') return root
  const idx = root.children.findIndex((c) => c.id === targetId)
  if (idx !== -1) {
    if (replacement === null) {
      const newChildren = root.children.filter((_, i) => i !== idx)
      if (newChildren.length === 1) return newChildren[0]
      const removed = root.sizes[idx] ?? 100 / root.children.length
      const newSizes = root.sizes
        .filter((_, i) => i !== idx)
        .map((s) => s + removed / (root.sizes.length - 1))
      return { ...root, children: newChildren, sizes: newSizes }
    }
    return {
      ...root,
      children: root.children.map((c, i) => (i === idx ? replacement : c)),
    }
  }
  return {
    ...root,
    children: root.children.map((c) => replaceInTree(c, targetId, replacement)),
  }
}

function patchNode<T extends PanelNode>(root: PanelNode, targetId: string, patch: Partial<T>): PanelNode {
  if (root.id === targetId) return { ...root, ...patch } as PanelNode
  if (root.type === 'split')
    return { ...root, children: root.children.map((c) => patchNode(c, targetId, patch)) }
  return root
}

// ── Preset builder ────────────────────────────────────────────────────────────

function buildPreset(cols: number, rows: number, cameraIds: string[]): PanelNode {
  let i = 0
  const next = (): string | null => cameraIds[i++] ?? null
  if (cols === 1 && rows === 1) return makeLeaf(next())
  const columns = Array.from({ length: cols }, () =>
    rows === 1
      ? makeLeaf(next())
      : makeSplit('vertical', Array.from({ length: rows }, () => makeLeaf(next()))),
  )
  return cols === 1 ? columns[0] : makeSplit('horizontal', columns)
}

// ── Store ─────────────────────────────────────────────────────────────────────

export type SplitDirection = 'left' | 'right' | 'top' | 'bottom'

interface LayoutState {
  root: PanelNode
  split: (nodeId: string, dir: SplitDirection) => void
  close: (nodeId: string) => void
  setCamera: (nodeId: string, cameraId: string | null) => void
  setSizes: (nodeId: string, sizes: number[]) => void
  applyPreset: (cols: number, rows: number, cameraIds: string[]) => void
  applyLayout: (root: PanelNode) => void
}

export const useLayoutStore = create<LayoutState>()((set) => ({
  root: makeLeaf(null),

  split: (nodeId, dir) =>
    set((s) => {
      const target = findLeaf(s.root, nodeId)
      if (!target) return s
      const orientation = (dir === 'left' || dir === 'right') ? 'horizontal' : 'vertical'
      const newLeaf = makeLeaf(null)
      const children = (dir === 'left' || dir === 'top') ? [newLeaf, target] : [target, newLeaf]
      const newSplit = makeSplit(orientation, children)
      if (s.root.id === nodeId) return { root: newSplit }
      return { root: replaceInTree(s.root, nodeId, newSplit) }
    }),

  close: (nodeId) =>
    set((s) => {
      if (s.root.id === nodeId) return { root: makeLeaf(null) }
      return { root: replaceInTree(s.root, nodeId, null) }
    }),

  setCamera: (nodeId, cameraId) =>
    set((s) => ({ root: patchNode(s.root, nodeId, { cameraId }) })),

  setSizes: (nodeId, sizes) =>
    set((s) => ({ root: patchNode(s.root, nodeId, { sizes }) })),

  applyPreset: (cols, rows, cameraIds) =>
    set(() => ({ root: buildPreset(cols, rows, cameraIds) })),

  applyLayout: (root) =>
    set(() => ({ root })),
}))
