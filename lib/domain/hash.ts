// Pure, dependency-free so both units.ts and protocol.ts can import it
// without creating a cycle (protocol.ts otherwise needs runtime bindings
// from units.ts, and units.ts's transitionUnit needs this to write the
// custody hash chain). Re-exported from lib/domain/protocol.ts per
// ARCHITECTURE.md section 5A's file layout.
import { createHash } from "crypto";

export type ChainableEvent = {
  unitId: string;
  eventType: string;
  fromFacilityId: string | null;
  toFacilityId: string | null;
  occurredAt: Date;
};

/**
 * event_hash = sha256((prev_hash ?? "GENESIS") + unit_id + event_type +
 * from_facility_id + to_facility_id + occurred_at.toISOString())
 *
 * ARCHITECTURE.md section 5A writes this as
 * `prev_hash ?? "GENESIS" + unit_id + ...` — as literal JS that parses as
 * `prev_hash ?? ("GENESIS" + unit_id + ...)`, since `??` binds looser than
 * `+`. Taken literally, a unit with any prior event would hash to a value
 * that never depends on the new event's own fields, which defeats the
 * point of a chain. Implemented with the parenthesization the spec's own
 * prose clearly intends: fall back to "GENESIS", then always append the
 * event's fields.
 */
export function hashEvent(prevHash: string | null, event: ChainableEvent): string {
  const input =
    (prevHash ?? "GENESIS") +
    event.unitId +
    event.eventType +
    (event.fromFacilityId ?? "") +
    (event.toFacilityId ?? "") +
    event.occurredAt.toISOString();
  return createHash("sha256").update(input).digest("hex");
}
