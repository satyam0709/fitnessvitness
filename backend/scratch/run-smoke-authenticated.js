const { fork, spawn } = require('child_process');
const prisma = require('../src/config/prisma');
const { generateAccessToken } = require('../src/services/authService');
require('dotenv').config();

const PORT = 5002;

async function setup() {
  console.log('Ensuring staff user exists...');
  const staff = await prisma.users.upsert({
    where: { email: 'staff@example.com' },
    update: {
      role: 'staff',
      is_active: true
    },
    create: {
      email: 'staff@example.com',
      password_hash: '$2b$12$AKNZXDWSRWmisSPWWx4wReJD1eRbGueYeFA7tUlZ4ZStCw.VqI7Zm',
      first_name: 'Staff',
      last_name: 'Member',
      role: 'staff',
      is_active: true,
      email_verified: true,
      must_change_password: false,
      is_platform_admin: false
    }
  });

  const superadminToken = generateAccessToken({ userId: 1, role: 'admin', is_platform_admin: 1 });
  const tenantAdminToken = generateAccessToken({ userId: 1, role: 'admin', is_platform_admin: 1 });
  const staffToken = generateAccessToken({ userId: staff.id, role: 'staff', is_platform_admin: 0 });

  return { superadminToken, tenantAdminToken, staffToken };
}

async function run() {
  const tokens = await setup();

  console.log('Starting backend server on port', PORT);
  const serverProc = fork('./src/server.js', [], {
    env: { ...process.env, PORT },
    silent: true
  });

  setTimeout(() => {
    console.log('Running smoke-api-contract.js with tokens...');
    const smokeProc = spawn('node', ['./scripts/smoke-api-contract.js'], {
      env: {
        ...process.env,
        SMOKE_BASE_URL: `http://localhost:${PORT}/api`,
        SMOKE_SUPERADMIN_TOKEN: tokens.superadminToken,
        SMOKE_TENANT_ADMIN_TOKEN: tokens.tenantAdminToken,
        SMOKE_STAFF_TOKEN: tokens.staffToken,
        SMOKE_STRICT: '1'
      }
    });

    smokeProc.stdout.on('data', (data) => {
      process.stdout.write(data);
    });

    smokeProc.stderr.on('data', (data) => {
      process.stderr.write(data);
    });

    smokeProc.on('close', (code) => {
      console.log(`Smoke test process exited with code ${code}`);
      serverProc.kill();
      process.exit(code);
    });
  }, 18000);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
