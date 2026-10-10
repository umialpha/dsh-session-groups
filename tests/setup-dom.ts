import { afterAll, beforeEach } from 'vitest'

const originalResizeObserver = Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver')
let installedResizeObserver = false

class TestResizeObserver implements ResizeObserver {
  private readonly targets = new Set<Element>()

  constructor(private readonly callback: ResizeObserverCallback) {}

  observe(target: Element): void {
    if (this.targets.has(target)) return
    this.targets.add(target)
    const width = target instanceof HTMLElement ? target.offsetWidth : 0
    const height = target instanceof HTMLElement ? target.offsetHeight : 0
    const size = [{ inlineSize: width, blockSize: height }]
    this.callback([{
      target,
      contentRect: new DOMRectReadOnly(0, 0, width, height),
      borderBoxSize: size,
      contentBoxSize: size,
      devicePixelContentBoxSize: size,
    }], this)
  }

  unobserve(target: Element): void { this.targets.delete(target) }

  disconnect(): void { this.targets.clear() }
}

beforeEach(() => {
  if (typeof document === 'undefined' || typeof ResizeObserver !== 'undefined') return
  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    writable: true,
    value: TestResizeObserver,
  })
  installedResizeObserver = true
})

afterAll(() => {
  if (!installedResizeObserver) return
  if (originalResizeObserver === undefined) Reflect.deleteProperty(globalThis, 'ResizeObserver')
  else Object.defineProperty(globalThis, 'ResizeObserver', originalResizeObserver)
})
