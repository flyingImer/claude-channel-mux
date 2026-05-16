import type { AgentDriver, AgentKind } from './types.js'

export class AgentRegistry {
  private drivers = new Map<AgentKind, AgentDriver>()

  register(driver: AgentDriver): void {
    if (this.drivers.has(driver.kind)) throw new Error(`Agent driver already registered: ${driver.kind}`)
    this.drivers.set(driver.kind, driver)
  }

  get(kind: AgentKind): AgentDriver {
    const driver = this.drivers.get(kind)
    if (!driver) throw new Error(`No agent driver registered for ${kind}`)
    return driver
  }

  all(): AgentDriver[] {
    return [...this.drivers.values()]
  }
}
