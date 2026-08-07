import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import ws from "ws";
import * as schema from "@/lib/schema";

// Deviation from a literal reading of ARCHITECTURE.md section 4: the neon-http
// driver has no real db.transaction() support (Drizzle/Neon confirm this — HTTP
// requests are stateless, so a multi-statement transaction can't be held open
// across round trips). Every domain invariant that matters here (custody_events
// written with a unit's status change, the two-row double-entry credit ledger,
// breach quarantine) depends on a real transaction. So this uses the WebSocket
// Pool from the SAME @neondatabase/serverless package instead of its HTTP mode —
// still Drizzle + @neondatabase/serverless, never node-postgres's raw pg Pool.
neonConfig.webSocketConstructor = ws;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export const db = drizzle(pool, { schema });
