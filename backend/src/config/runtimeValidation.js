function isWeakSecret(value) {
  const v = String(value || "").trim().toLowerCase();
  if (!v) return true;
  if (v.length < 24) return true;
  const weak = ["changeme", "password", "secret", "test", "dev", "default"];
  return weak.some((w) => v.includes(w));
}

function assertRequiredEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function validateRuntimeEnv() {
  const prod = process.env.NODE_ENV === "production";
  const required = [
    "DB_HOST",
    "DB_PORT",
    "DB_USER",
    "DB_NAME",
    "JWT_SECRET",
    "JWT_REFRESH_SECRET",
  ];

  for (const name of required) {
    assertRequiredEnv(name);
  }

  const dbPass = String(process.env.DB_PASSWORD || process.env.DB_PASS || "").trim();
  if (!dbPass) {
    throw new Error("Missing required env var: DB_PASSWORD or DB_PASS");
  }

  if (prod) {
    const checks = [
      ["JWT_SECRET", process.env.JWT_SECRET],
      ["JWT_REFRESH_SECRET", process.env.JWT_REFRESH_SECRET],
      ["DB_PASSWORD/DB_PASS", dbPass],
    ];
    for (const [name, value] of checks) {
      if (isWeakSecret(value)) {
        throw new Error(`Weak or invalid secret detected for ${name}. Rotate before production launch.`);
      }
    }
  }
}

module.exports = { validateRuntimeEnv };