// drivers/index.ts — platform detection and driver wiring.
// The rest of the codebase calls createDrivers() once and never imports
// platform-specific modules directly.

import { Drivers } from "./interfaces";
import { NvidiaSmiTelemetry } from "./nvidia-smi";
import { WindowsForegroundDetector } from "./windows/foreground";
import { WindowsPowerController } from "./windows/power";
import { WindowsProcessController } from "./windows/process";
import { LinuxForegroundDetector } from "./linux/foreground";
import { LinuxPowerController } from "./linux/power";
import { LinuxProcessController } from "./linux/process";

export function createDrivers(): Drivers {
  const telemetry = new NvidiaSmiTelemetry(); // shared: nvidia-smi CSV on both platforms

  if (process.platform === "win32") {
    return {
      platform: "windows",
      telemetry,
      processes: new WindowsProcessController(),
      power: new WindowsPowerController(),
      foreground: new WindowsForegroundDetector(),
    };
  }

  if (process.platform === "linux") {
    return {
      platform: "linux",
      telemetry,
      processes: new LinuxProcessController(),
      power: new LinuxPowerController(),
      foreground: new LinuxForegroundDetector(),
    };
  }

  throw new Error(
    `Unsupported platform: ${process.platform} (NVPilot supports Windows and Linux)`
  );
}
