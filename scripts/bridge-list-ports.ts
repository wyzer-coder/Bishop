// `pnpm bridge:ports` — lists connected serial devices so you can find the
// right value for BRIDGE_SERIAL_PORT in .env.local.
import { SerialPort } from "serialport";

async function main() {
  const ports = await SerialPort.list();
  if (ports.length === 0) {
    console.log("No serial ports found. Is the Arduino plugged in?");
    return;
  }
  console.log("Available serial ports:");
  for (const p of ports) {
    console.log(`  ${p.path}  ${p.manufacturer ?? ""} ${p.serialNumber ?? ""}`.trimEnd());
  }
  console.log("\nThe Arduino is usually the one with a manufacturer name (e.g. wch.cn, Arduino, FTDI).");
}

main();
