import type { WorldState } from "./types.ts";

/**
 * Deterministic baseline state (FR-020, FR-021): 5 services and exactly 6
 * alerts (3 firing, 3 resolved) with varied severities, no incidents.
 * Fixed ids and timestamps so reapplying produces an identical state.
 */
export function baselineState(): WorldState {
  return {
    services: [
      { id: "checkout", name: "Checkout" },
      { id: "payments", name: "Payments" },
      { id: "auth", name: "Auth" },
      { id: "search", name: "Search" },
      { id: "notifications", name: "Notifications" },
    ],
    alerts: [
      {
        id: "alert-1",
        serviceId: "checkout",
        summary: "Checkout error rate above threshold",
        severity: "critical",
        status: "firing",
        firedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
      {
        id: "alert-2",
        serviceId: "payments",
        summary: "Payment gateway latency spike",
        severity: "high",
        status: "firing",
        firedAt: new Date("2026-01-01T00:05:00.000Z"),
      },
      {
        id: "alert-3",
        serviceId: "auth",
        summary: "Elevated login failures",
        severity: "medium",
        status: "firing",
        firedAt: new Date("2026-01-01T00:10:00.000Z"),
      },
      {
        id: "alert-4",
        serviceId: "search",
        summary: "Search index lag",
        severity: "low",
        status: "resolved",
        firedAt: new Date("2026-01-01T00:15:00.000Z"),
      },
      {
        id: "alert-5",
        serviceId: "notifications",
        summary: "Push notification delivery delay",
        severity: "medium",
        status: "resolved",
        firedAt: new Date("2026-01-01T00:20:00.000Z"),
      },
      {
        id: "alert-6",
        serviceId: "checkout",
        summary: "Checkout cart abandonment spike",
        severity: "high",
        status: "resolved",
        firedAt: new Date("2026-01-01T00:25:00.000Z"),
      },
    ],
    incidents: [],
  };
}
