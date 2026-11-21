import { useEffect } from 'react'

// Tafle szkła, które łapią światło kursora. Ta sama lista jest w index.css (sekcja „szkło”) – zmieniaj obie.
const GLASS = '.app-header, .details, .assistant, .table-wrap, .filters, .empty, .toast'

/**
 * Odblask na szkle podąża za kursorem: na tafli pod wskaźnikiem ustawiamy --mx/--my (piksele względem tafli),
 * a CSS rysuje w tym miejscu jaśniejszą plamę. Po zejściu z tafli odblask wraca na miejsce domyślne,
 * a przy przewijaniu liczymy go od nowa. Jeden nasłuch, najwyżej jedna aktualizacja na klatkę; działa
 * tylko dla myszy (dotyk i pióro pomijamy).
 */
export function useGlassPointer() {
  useEffect(() => {
    let frame = 0
    let pointer: { x: number; y: number } | null = null
    let lit: HTMLElement | null = null

    const reset = () => {
      lit?.style.removeProperty('--mx')
      lit?.style.removeProperty('--my')
      lit = null
    }
    const paint = () => {
      frame = 0
      if (!pointer) return
      const under = document.elementFromPoint(pointer.x, pointer.y)
      const pane = under?.closest<HTMLElement>(GLASS) ?? null
      if (pane !== lit) reset()
      if (!pane) return
      const rect = pane.getBoundingClientRect()
      pane.style.setProperty('--mx', `${pointer.x - rect.left}px`)
      pane.style.setProperty('--my', `${pointer.y - rect.top}px`)
      lit = pane
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(paint)
    }
    const onMove = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return
      pointer = { x: event.clientX, y: event.clientY }
      schedule()
    }
    const onLeave = () => {
      pointer = null
      reset()
    }

    document.addEventListener('pointermove', onMove, { passive: true })
    document.documentElement.addEventListener('pointerleave', onLeave)
    window.addEventListener('scroll', schedule, { passive: true })
    return () => {
      document.removeEventListener('pointermove', onMove)
      document.documentElement.removeEventListener('pointerleave', onLeave)
      window.removeEventListener('scroll', schedule)
      cancelAnimationFrame(frame)
      reset()
    }
  }, [])
}
