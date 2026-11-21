import { useEffect } from 'react'

// Tafle szkła, które łapią światło kursora (te same selektory co w index.css).
const GLASS = '.app-header, .details, .assistant, .table-wrap, .filters, .empty, .toast'

/**
 * Odblask na szkle podąża za kursorem: na tafli pod wskaźnikiem ustawiamy --mx/--my (piksele względem tafli),
 * a CSS rysuje w tym miejscu jaśniejszą plamę. Jeden nasłuch na dokumencie, najwyżej jedna aktualizacja
 * na klatkę; na ekranach dotykowych (bez kursora) nic nie robi.
 */
export function useGlassPointer() {
  useEffect(() => {
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return
    let frame = 0
    let last: PointerEvent | null = null

    const paint = () => {
      frame = 0
      if (!last || !(last.target instanceof Element)) return
      const pane = last.target.closest<HTMLElement>(GLASS)
      if (!pane) return
      const rect = pane.getBoundingClientRect()
      pane.style.setProperty('--mx', `${last.clientX - rect.left}px`)
      pane.style.setProperty('--my', `${last.clientY - rect.top}px`)
    }
    const onMove = (event: PointerEvent) => {
      last = event
      if (!frame) frame = requestAnimationFrame(paint)
    }

    document.addEventListener('pointermove', onMove, { passive: true })
    return () => {
      document.removeEventListener('pointermove', onMove)
      cancelAnimationFrame(frame)
    }
  }, [])
}
