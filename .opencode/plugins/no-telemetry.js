/**
 * Disable Cozempic (and similar tools) telemetry, auto-update, and global
 * hook wiring for every shell execution opencode performs.
 *
 * Env vars:
 *   COZEMPIC_NO_TELEMETRY=1      — stop anonymous counter pings
 *   COZEMPIC_NO_AUTO_UPDATE=1    — prevent daily auto-update from PyPI
 *   COZEMPIC_NO_GLOBAL_INIT=1    — skip wiring hooks into ~/.claude/settings.json
 */
export const NoTelemetryPlugin = async () => {
  return {
    "shell.env": async (_input, output) => {
      output.env.COZEMPIC_NO_TELEMETRY = "1";
      output.env.COZEMPIC_NO_AUTO_UPDATE = "1";
      output.env.COZEMPIC_NO_GLOBAL_INIT = "1";
    },
  };
};
