/*
 * BishopOS - RFID scanner
 * Arduino Uno + RC522
 *
 * Prints one JSON line per card tap over USB serial.
 *
 * WIRING (RC522 -> Arduino Uno):
 *   SDA  -> D10
 *   SCK  -> D13
 *   MOSI -> D11
 *   MISO -> D12
 *   IRQ  -> leave empty
 *   GND  -> GND
 *   RST  -> D9
 *   3.3V -> 3.3V      <-- 3.3V ONLY. 5V DESTROYS THE MODULE.
 *
 * LIBRARY: "MFRC522" by GithubCommunity
 *   Arduino IDE -> Tools -> Manage Libraries -> search MFRC522 -> Install
 *
 * BOARD: Arduino Uno.  SERIAL MONITOR BAUD: 115200
 *
 * The Uno has no network interface. scripts/bridge.ts (run on whatever
 * machine this is plugged into via USB) reads these lines and forwards
 * card taps to POST /api/ingest/scan.
 */

#include <SPI.h>
#include <MFRC522.h>

#define SS_PIN  10
#define RST_PIN  9

MFRC522 rfid(SS_PIN, RST_PIN);

String   lastUid    = "";
uint32_t lastScanAt = 0;

void setup() {
  Serial.begin(115200);
  while (!Serial) { ; }

  SPI.begin();
  rfid.PCD_Init();
  delay(50);

  // Wiring self-test.
  // 0x91 or 0x92 = reader healthy.
  // 0x00 = no response, check 3.3V / GND / D10 / D9.
  // 0xFF = MISO floating, check D12.
  byte v = rfid.PCD_ReadRegister(MFRC522::VersionReg);
  Serial.print(F("{\"event\":\"boot\",\"chipVersion\":\"0x"));
  if (v < 0x10) Serial.print(F("0"));
  Serial.print(v, HEX);
  Serial.print(F("\",\"ok\":"));
  Serial.print((v == 0x91 || v == 0x92) ? F("true") : F("false"));
  Serial.println(F("}"));
}

void loop() {
  if (!rfid.PICC_IsNewCardPresent()) return;
  if (!rfid.PICC_ReadCardSerial())   return;

  // Build the UID as uppercase hex, e.g. 04A3B2C1
  String uid = "";
  for (byte i = 0; i < rfid.uid.size; i++) {
    if (rfid.uid.uidByte[i] < 0x10) uid += "0";
    uid += String(rfid.uid.uidByte[i], HEX);
  }
  uid.toUpperCase();

  uint32_t now = millis();

  // Ignore the same card tapped again within 3 seconds.
  if (uid != lastUid || now - lastScanAt > 3000) {
    lastUid    = uid;
    lastScanAt = now;

    Serial.print(F("{\"event\":\"scan\",\"uid\":\""));
    Serial.print(uid);
    Serial.println(F("\"}"));
  }

  rfid.PICC_HaltA();
  rfid.PCD_StopCrypto1();
}
