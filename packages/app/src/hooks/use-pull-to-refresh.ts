import { createSignal, onCleanup } from "solid-js"

export function usePullToRefresh(opts: {
  onRefresh: () => Promise<void>
  scrollElement: () => HTMLElement | undefined
  threshold?: number
  maxPull?: number
  onHaptic?: () => void
  isNestedScrollable?: (target: EventTarget | null) => boolean
}) {
  const threshold = opts.threshold ?? 80
  const maxPull = opts.maxPull ?? 120

  const [pulling, setPulling] = createSignal(false)
  const [pullDistance, setPullDistance] = createSignal(0)
  const [refreshing, setRefreshing] = createSignal(false)

  let startY = 0
  let startX = 0
  let active = false
  let hapticFired = false
  let directionLocked = false
  let horizontalLock = false
  let atTopOnStart = false
  let touchEl: HTMLElement | undefined

  const progress = () => Math.min(pullDistance() / threshold, 1)

  const scrollTop = () => opts.scrollElement()?.scrollTop ?? 0

  const onTouchStart = (e: TouchEvent) => {
    if (refreshing()) return
    const touch = e.touches[0]
    if (!touch) return
    startY = touch.clientY
    startX = touch.clientX
    active = false
    hapticFired = false
    directionLocked = false
    horizontalLock = false
    atTopOnStart = scrollTop() <= 0
  }

  const onTouchMove = (e: TouchEvent) => {
    if (refreshing()) return
    if (horizontalLock) return
    const touch = e.touches[0]
    if (!touch) return

    const deltaY = touch.clientY - startY
    const deltaX = touch.clientX - startX

    if (!directionLocked) {
      // At top and pulling down: prevent default BEFORE direction lock
      // to stop iOS from starting native overscroll/bounce
      if (atTopOnStart && deltaY > 0 && Math.abs(deltaY) >= Math.abs(deltaX)) {
        e.preventDefault()
      }

      if (Math.abs(deltaX) + Math.abs(deltaY) < 10) return
      directionLocked = true
      if (Math.abs(deltaX) > Math.abs(deltaY)) {
        horizontalLock = true
        return
      }
    }

    if (scrollTop() > 0) {
      if (active) {
        active = false
        setPulling(false)
        setPullDistance(0)
      }
      return
    }

    if (opts.isNestedScrollable?.(e.target)) return

    if (deltaY <= 0) {
      if (active) {
        active = false
        setPulling(false)
        setPullDistance(0)
      }
      return
    }

    if (!active) {
      active = true
      startY = touch.clientY
      setPulling(true)
    }

    e.preventDefault()

    const distance = Math.min(touch.clientY - startY, maxPull)
    setPullDistance(distance)

    const crossed = distance >= threshold
    if (crossed && !hapticFired) {
      hapticFired = true
      opts.onHaptic?.()
    }
    if (!crossed && hapticFired) {
      hapticFired = false
      opts.onHaptic?.()
    }
  }

  const onTouchEnd = () => {
    if (!active) return
    active = false

    if (pullDistance() >= threshold && !refreshing()) {
      setRefreshing(true)
      setPullDistance(threshold)
      opts
        .onRefresh()
        .catch(() => {})
        .finally(() => {
          setRefreshing(false)
          setPulling(false)
          setPullDistance(0)
        })
    } else {
      setPulling(false)
      setPullDistance(0)
    }
  }

  const setRef = (el: HTMLElement) => {
    if (touchEl) {
      touchEl.removeEventListener("touchstart", onTouchStart)
      touchEl.removeEventListener("touchmove", onTouchMove)
      touchEl.removeEventListener("touchend", onTouchEnd)
      touchEl.removeEventListener("touchcancel", onTouchEnd)
    }
    touchEl = el
    // passive: false on touchmove is critical — lets us call preventDefault()
    // to block iOS native overscroll/bounce so the pull gesture is captured.
    el.addEventListener("touchstart", onTouchStart, { passive: true })
    el.addEventListener("touchmove", onTouchMove, { passive: false })
    el.addEventListener("touchend", onTouchEnd)
    el.addEventListener("touchcancel", onTouchEnd)

    onCleanup(() => {
      el.removeEventListener("touchstart", onTouchStart)
      el.removeEventListener("touchmove", onTouchMove)
      el.removeEventListener("touchend", onTouchEnd)
      el.removeEventListener("touchcancel", onTouchEnd)
    })
  }

  return { pulling, progress, refreshing, pullDistance, setRef }
}
