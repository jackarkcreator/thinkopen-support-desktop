// "Start remote support" launcher (shell 1.2.0). The client clicks one button
// on their ticket; this fetches the ThinkOpen Support RustDesk client with the
// user's signed-in portal session (no Downloads folder), verifies its code
// signature against a PINNED signer, caches it under userData, and launches
// it. The web app then finds this machine's RustDesk ID by hostname
// (thinkopen-net api/remote-sessions/[id]/auto-id). Plan:
// thinkopen-net docs/okvia/remote-support-plan.md.
//
// Trust: the binary comes from our portal over TLS, but we still refuse to run
// anything whose signature isn't the RustDesk build service's (Windows:
// Authenticode by Purslane / DigiCert; macOS: Developer ID team + Gatekeeper).
// Re-verified before EVERY launch, so a tampered cache never runs.

const { app } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { execFile, spawn } = require("node:child_process");

const PORTAL_HOSTS = new Set(["support.okvia.io", "support.thinkopen.net"]);
const DEFAULT_ORIGIN = "https://support.okvia.io";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // re-fetch daily so rebuilds reach clients

// Signer pins. Windows: read from the 2026-09-18 build (Authenticode chain
// DigiCert Trusted G4 Code Signing → O=Purslane, serialNumber=53481265A).
const WIN_SIGNER_MUST_CONTAIN = ["O=Purslane", "SERIALNUMBER=53481265A"];
// macOS: Developer ID team of the notarized custom client (codesign -dv).
const MAC_TEAM_ID = "__PIN_ME__";

let busy = false;

function run(cmd, args, timeout = 60_000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, maxBuffer: 8 << 20 }, (err, stdout, stderr) =>
      resolve({ ok: !err, stdout: String(stdout || ""), stderr: String(stderr || "") }),
    );
  });
}

function cacheDir() {
  const d = path.join(app.getPath("userData"), "remote-support");
  fs.mkdirSync(d, { recursive: true });
  return d;
}

/** Hostname as RustDesk reports it (device_name). macOS: never os.hostname(),
 *  which can be network-derived (reverse DNS → "192"). */
async function localHostname() {
  if (process.platform === "darwin") {
    const r = await run("/usr/sbin/scutil", ["--get", "LocalHostName"], 5000);
    const h = r.stdout.trim();
    if (r.ok && h) return h;
  }
  return os.hostname() || null;
}

function portalOrigin(win) {
  try {
    const u = new URL(win.webContents.getURL());
    if (u.protocol === "https:" && PORTAL_HOSTS.has(u.hostname)) return u.origin;
  } catch {
    /* fall through */
  }
  return DEFAULT_ORIGIN;
}

async function download(win, osKey, dest) {
  const res = await win.webContents.session.fetch(`${portalOrigin(win)}/api/remote-sessions/client/${osKey}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`download HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1_000_000) throw new Error("download too small");
  fs.writeFileSync(dest, buf);
}

function fresh(p) {
  try {
    return Date.now() - fs.statSync(p).mtimeMs < CACHE_TTL_MS;
  } catch {
    return false;
  }
}

// ---- Windows ----------------------------------------------------------------

async function verifyWindows(exe) {
  const ps =
    `$s = Get-AuthenticodeSignature -LiteralPath '${exe.replace(/'/g, "''")}'; ` +
    `"$($s.Status)|$($s.SignerCertificate.Subject)"`;
  const r = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], 30_000);
  const [status, subject = ""] = r.stdout.trim().split("|");
  const subj = subject.toUpperCase();
  return r.ok && status === "Valid" && WIN_SIGNER_MUST_CONTAIN.every((s) => subj.includes(s.toUpperCase()));
}

async function startWindows(win) {
  const dir = cacheDir();
  const exe = path.join(dir, "ThinkOpen-Support.exe");
  if (!fresh(exe)) {
    const tmp = path.join(dir, `download-${Date.now()}.exe`);
    try {
      await download(win, "windows", tmp);
    } catch {
      fs.rmSync(tmp, { force: true });
      if (!fs.existsSync(exe)) return { ok: false, error: "download_failed" };
    }
    if (fs.existsSync(tmp)) {
      if (!(await verifyWindows(tmp))) {
        fs.rmSync(tmp, { force: true });
        return { ok: false, error: "signature_invalid" };
      }
      try {
        fs.rmSync(exe, { force: true }); // fails while it's running: keep the old copy
        fs.renameSync(tmp, exe);
      } catch {
        fs.rmSync(tmp, { force: true });
      }
    }
  }
  if (!(await verifyWindows(exe))) {
    fs.rmSync(exe, { force: true });
    return { ok: false, error: "signature_invalid" };
  }
  try {
    spawn(exe, [], { detached: true, stdio: "ignore", windowsHide: false }).unref();
  } catch {
    return { ok: false, error: "launch_failed" };
  }
  return { ok: true };
}

// ---- macOS ------------------------------------------------------------------

async function verifyMac(appPath) {
  if (!/^[A-Z0-9]{10}$/.test(MAC_TEAM_ID)) return false; // unpinned build: never run
  const v = await run("/usr/bin/codesign", ["--verify", "--deep", "--strict", appPath]);
  if (!v.ok) return false;
  const d = await run("/usr/bin/codesign", ["-dv", appPath]);
  const team = /TeamIdentifier=(\S+)/.exec(d.stderr)?.[1];
  if (team !== MAC_TEAM_ID) return false;
  const g = await run("/usr/sbin/spctl", ["--assess", "--type", "execute", appPath]);
  return g.ok;
}

async function extractDmg(dmg, destApp) {
  const mnt = fs.mkdtempSync(path.join(os.tmpdir(), "tosupport-"));
  const a = await run("/usr/bin/hdiutil", ["attach", "-nobrowse", "-readonly", "-noautoopen", "-mountpoint", mnt, dmg]);
  if (!a.ok) throw new Error("hdiutil attach failed");
  try {
    const name = fs.readdirSync(mnt).find((f) => f.endsWith(".app"));
    if (!name) throw new Error("no .app in dmg");
    fs.rmSync(destApp, { recursive: true, force: true });
    const c = await run("/usr/bin/ditto", [path.join(mnt, name), destApp]);
    if (!c.ok) throw new Error("ditto failed");
  } finally {
    await run("/usr/bin/hdiutil", ["detach", mnt, "-force"]);
    fs.rmSync(mnt, { recursive: true, force: true });
  }
}

async function startMac(win) {
  // The custom client is built for Apple silicon only (no Intel option yet).
  if (process.arch !== "arm64") return { ok: false, error: "unsupported_os" };
  const dir = cacheDir();
  const appPath = path.join(dir, "ThinkOpen-Support.app");
  if (!fresh(appPath)) {
    const dmg = path.join(dir, `download-${Date.now()}.dmg`);
    const staging = path.join(dir, "staging.app");
    try {
      await download(win, "mac", dmg);
      await extractDmg(dmg, staging);
      if (!(await verifyMac(staging))) {
        fs.rmSync(staging, { recursive: true, force: true });
        return { ok: false, error: "signature_invalid" };
      }
      fs.rmSync(appPath, { recursive: true, force: true });
      fs.renameSync(staging, appPath);
    } catch {
      fs.rmSync(staging, { recursive: true, force: true });
      if (!fs.existsSync(appPath)) return { ok: false, error: "download_failed" };
    } finally {
      fs.rmSync(dmg, { force: true });
    }
  }
  if (!(await verifyMac(appPath))) {
    fs.rmSync(appPath, { recursive: true, force: true });
    return { ok: false, error: "signature_invalid" };
  }
  const o = await run("/usr/bin/open", [appPath], 15_000);
  return o.ok ? { ok: true } : { ok: false, error: "launch_failed" };
}

async function startRemoteSupport(win) {
  if (busy) return { ok: false, error: "busy" };
  busy = true;
  try {
    let r;
    if (process.platform === "win32") r = await startWindows(win);
    else if (process.platform === "darwin") r = await startMac(win);
    else r = { ok: false, error: "unsupported_os" };
    return { ...r, hostname: await localHostname() };
  } catch (e) {
    console.warn("[remote-support]", e && e.message);
    return { ok: false, error: "launch_failed", hostname: await localHostname() };
  } finally {
    busy = false;
  }
}

module.exports = { startRemoteSupport, WIN_SIGNER_MUST_CONTAIN, MAC_TEAM_ID };
