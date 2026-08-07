import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { devices } from "@/lib/schema";

/** Devices authenticate with X-Device-Key only (never Clerk). */
export async function getDeviceByKey(deviceKey: string) {
  const [device] = await db
    .select()
    .from(devices)
    .where(eq(devices.deviceKey, deviceKey))
    .limit(1);
  return device ?? null;
}
