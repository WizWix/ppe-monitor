import { useEffect, useRef, useState, useCallback } from 'react'
import type { CameraFrame } from '../types'

interface StreamState {
  frame: CameraFrame | null
  connected: boolean
  error: string | null
}

export function useCameraStream(cameraId: string | null): StreamState {
  const [state, setState] = useState<StreamState>({ frame: null, connected: false, error: null })
  const wsRef = useRef<WebSocket | null>(null)
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const retryCount = useRef(0)

  const connect = useCallback(() => {
    if (!cameraId) return

    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const url = `${protocol}://${window.location.host}/ws/cameras/${cameraId}/stream`
    const ws = new WebSocket(url)
    wsRef.current = ws

    ws.onopen = () => {
      retryCount.current = 0
      setState((s) => ({ ...s, connected: true, error: null }))
    }

    ws.onmessage = (evt) => {
      try {
        const data = JSON.parse(evt.data)
        if (data.type === 'ping' || data.error) return
        setState((s) => ({ ...s, frame: data as CameraFrame }))
      } catch {}
    }

    ws.onclose = () => {
      setState((s) => ({ ...s, connected: false }))
      const delay = Math.min(1000 * 2 ** retryCount.current, 16000)
      retryCount.current++
      retryRef.current = setTimeout(connect, delay)
    }

    ws.onerror = () => {
      setState((s) => ({ ...s, error: '연결 오류' }))
      ws.close()
    }
  }, [cameraId])

  useEffect(() => {
    connect()
    return () => {
      if (retryRef.current) clearTimeout(retryRef.current)
      wsRef.current?.close()
    }
  }, [connect])

  return state
}
