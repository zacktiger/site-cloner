// Runs before `npm run dev`. If an old copy of the app is still running, the new one
// cannot get its ports and fails in confusing ways, so stop early with a clear message.
import net from "node:net";

const PORTS = { 5173: "web UI", 5174: "preview server", 3001: "agent server" };

const inUse = (port) =>
  new Promise((resolve) => {
    const socket = net.connect({ port, host: "localhost" });
    socket.setTimeout(1000);
    socket.once("connect", () => (socket.destroy(), resolve(true)));
    socket.once("timeout", () => (socket.destroy(), resolve(false)));
    socket.once("error", () => resolve(false));
  });

const busy = [];
for (const [port, name] of Object.entries(PORTS)) {
  if (await inUse(Number(port))) busy.push(`${port} (${name})`);
}

if (busy.length) {
  const ports = Object.keys(PORTS).join(",");
  console.error(`\nThese ports are already in use: ${busy.join(", ")}.`);
  console.error("Another copy of Site Cloner is probably still running. Stop it and run `npm run dev` again.");
  console.error("\nTo stop whatever is using them (PowerShell):");
  console.error(`  Get-NetTCPConnection -LocalPort ${ports} -State Listen | % { Stop-Process -Id $_.OwningProcess -Force }`);
  console.error("macOS / Linux:");
  console.error(`  lsof -ti tcp:${ports.replaceAll(",", ",tcp:")} | xargs kill\n`);
  process.exit(1);
}
