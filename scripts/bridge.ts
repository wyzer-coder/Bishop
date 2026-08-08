// The Arduino Uno has no network interface — it can only talk over USB
// serial. This bridges that to the website: reads each JSON line the
// bishop_node sketch prints over Serial and forwards card taps to
// POST /api/ingest/scan, exactly like an ESP32 would if it could speak
// HTTPS directly. Runs on whatever machine the Arduino is plugged into.
import { SerialPort } from "serialport";
import { ReadlineParser } from "@serialport/parser-readline";

const PORT = process.env.BRIDGE_SERIAL_PORT;
const BAUD = Number(process.env.BRIDGE_BAUD_RATE ?? 115200);
const DEVICE_KEY = process.env.BRIDGE_DEVICE_KEY ?? process.env.DEMO_DEVICE_KEY ?? "DEV-HUB-SCANNER-01";
const API_URL = process.env.BRIDGE_API_URL ?? "http://localhost:3000";

type SketchLine =
  | { event: "boot"; chipVersion: string; ok: boolean }
  | { event: "scan"; uid: string };

if (!PORT) {
  console.error("bridge: set BRIDGE_SERIAL_PORT in .env.local, e.g.:");
  console.error("  BRIDGE_SERIAL_PORT=/dev/ttyACM0   (Linux)");
  console.error("  BRIDGE_SERIAL_PORT=/dev/cu.usbmodemXXXX   (Mac)");
  console.error("  BRIDGE_SERIAL_PORT=COM3   (Windows)");
  console.error("Run `pnpm bridge:ports` to list what's actually connected.");
  process.exit(1);
}

async function postScan(uid: string) {
  try {
    const res = await fetch(`${API_URL}/api/ingest/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Device-Key": DEVICE_KEY },
      body: JSON.stringify({ rfidUid: uid }),
    });
    const body = await res.json().catch(() => ({}));

    if (res.status === 404) {
      console.log(`bridge: ${uid} is unknown — check the browser for the "New unit detected" dialog`);
      return;
    }
    if (!res.ok) {
      console.error(`bridge: scan rejected (HTTP ${res.status}):`, body);
      return;
    }
    console.log(`bridge: ${uid} -> ${body.outcome}${body.detail ? " — " + body.detail : ""}`);
  } catch (err) {
    console.error(
      `bridge: couldn't reach ${API_URL} —`,
      err instanceof Error ? err.message : err,
    );
  }
}

function main() {
  const port = new SerialPort({ path: PORT!, baudRate: BAUD });
  const parser = port.pipe(new ReadlineParser({ delimiter: "\n" }));

  port.on("open", () => {
    console.log(`bridge: connected to ${PORT} at ${BAUD} baud, posting to ${API_URL}`);
    console.log(`bridge: using device key ${DEVICE_KEY}`);
    console.log("bridge: waiting for card taps…");
  });

  port.on("error", (err) => {
    console.error("bridge: serial port error —", err.message);
    console.error("bridge: is the Arduino plugged in, and is BRIDGE_SERIAL_PORT correct?");
    console.error("bridge: on Linux, you may need `sudo usermod -a -G dialout $USER` then log out/in.");
  });

  parser.on("data", (raw: string) => {
    const line = raw.trim();
    if (!line) return;

    let msg: SketchLine;
    try {
      msg = JSON.parse(line);
    } catch {
      console.log(`bridge: (non-JSON from Arduino, ignored) ${line}`);
      return;
    }

    if (msg.event === "boot") {
      console.log(`bridge: reader booted — chip ${msg.chipVersion}, self-test ok=${msg.ok}`);
      if (!msg.ok) {
        console.warn("bridge: reader reports NOT ok — check 3.3V/GND/SDA(D10)/RST(D9) wiring");
      }
      return;
    }

    if (msg.event === "scan" && msg.uid) {
      console.log(`bridge: tap ${msg.uid}`);
      void postScan(msg.uid);
    }
  });
}

main();
