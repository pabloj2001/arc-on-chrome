const { defineConfig } = require("@playwright/test");

// Chrome extensions (MV3) can only be loaded into a headed persistent context,
// so these run headed and single-worker (each test gets its own browser + fresh
// extension storage via the fixture in tests/e2e/fixtures.js).
module.exports = defineConfig({
  testDir: "./tests/e2e",
  timeout: 45_000,
  expect: { timeout: 6_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    actionTimeout: 6_000,
    trace: "off",
  },
});
