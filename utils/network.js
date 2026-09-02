const os = require("os");

/**
 * Dynamically detects the active IPv4 LAN address of the host machine.
 * Prioritizes Wi-Fi and Ethernet adapters, falling back to any non-internal IPv4,
 * or "localhost" if no active network interface is found.
 */
const getLanIp = () => {
  const interfaces = os.networkInterfaces();
  let fallbackIp = null;
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name]) {
      const familyV4 = net.family === "IPv4" || net.family === 4;
      if (familyV4 && !net.internal) {
        if (/wi-fi|ethernet|wlan|eth/i.test(name)) {
          return net.address;
        }
        if (!fallbackIp) fallbackIp = net.address;
      }
    }
  }
  return fallbackIp || "localhost";
};

/**
 * Returns the backend base URL.
 * Uses process.env.BACKEND_URL if explicitly configured.
 * Otherwise, constructs a LAN-reachable URL using the active LAN IPv4 address and PORT.
 */
const getBackendBaseUrl = () => {
  if (process.env.BACKEND_URL && process.env.BACKEND_URL.trim() !== "") {
    return process.env.BACKEND_URL.trim();
  }
  const port = process.env.PORT || 8080;
  const lanIp = getLanIp();
  return `http://${lanIp}:${port}`;
};

module.exports = {
  getLanIp,
  getBackendBaseUrl,
};
