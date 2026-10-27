const path = require("node:path");
const QRCode = require("qrcode");

const baseUrl = (process.env.CASE_ZERO_PUBLIC_URL || "http://127.0.0.1:3000").replace(/\/+$/, "");
const payload = `${baseUrl}/scan-er-02.html`;
const output = path.join(__dirname, "..", "public", "evidence", "round-1", "qr-inventory.svg");

if (!/^https?:\/\/[^/\s]+$/i.test(baseUrl)) {
  console.error("CASE_ZERO_PUBLIC_URL must be a reachable site origin, such as https://case-zero.example.edu.");
  process.exitCode = 1;
} else {
QRCode.toFile(output, payload, {
  type: "svg",
  errorCorrectionLevel: "M",
  margin: 3,
  width: 420,
  color: {
    dark: "#21040b",
    light: "#fff8f4"
  }
}).then(() => {
  console.log(`Generated ER-02 scan QR for ${payload} at ${output}`);
  if (/^http:\/\/127\.0\.0\.1(?::|$)/i.test(baseUrl) || /^http:\/\/localhost(?::|$)/i.test(baseUrl)) {
    console.warn("This local QR URL is only reachable on the same computer. Set CASE_ZERO_PUBLIC_URL to a phone-reachable LAN address or hosted HTTPS origin before printing.");
  }
}).catch((error) => {
  console.error("Could not generate the ER-02 QR evidence.", error);
  process.exitCode = 1;
});
}
