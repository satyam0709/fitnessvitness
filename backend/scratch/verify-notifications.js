const { generateAccessToken } = require('../src/services/authService');
const http = require('http');
const prisma = require('../src/config/prisma');

const PORT = 5002;
const token = generateAccessToken({ userId: 1, role: 'admin', is_platform_admin: 1 });

async function request(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: 'localhost',
      port: PORT,
      path: '/api' + path,
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', reject);
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function run() {
  const { fork } = require('child_process');
  
  console.log('Seeding dummy notification...');
  await prisma.notifications.create({
    data: {
      user_id: 1,
      actor_user_id: 1,
      entity_type: 'general',
      title: 'Test Notification',
      body: 'This is a test notification for integration verification',
      is_read: false
    }
  });

  console.log('Starting backend server on port', PORT);
  const server = fork('./src/server.js', [], {
    env: { ...process.env, PORT },
    silent: false
  });

  setTimeout(async () => {
    try {
      console.log('Testing GET /notifications...');
      const getRes = await request('GET', '/notifications');
      console.log('GET /notifications Status:', getRes.status, 'Body:', getRes.body);
      if (getRes.status !== 200 || !getRes.body.success) {
        throw new Error('GET /notifications failed');
      }

      console.log('Testing PATCH /notifications/read-all...');
      const patchRes = await request('PATCH', '/notifications/read-all');
      console.log('PATCH /notifications/read-all Status:', patchRes.status, 'Body:', patchRes.body);
      if (patchRes.status !== 200 || !patchRes.body.success) {
        throw new Error('PATCH /notifications/read-all failed');
      }

      console.log('\n==========================================');
      console.log('🎉 ALL NOTIFICATIONS ROUTE TESTS PASSED 🎉');
      console.log('==========================================\n');
      server.kill();
      process.exit(0);
    } catch (err) {
      console.error('Test failed:', err);
      server.kill();
      process.exit(1);
    }
  }, 15000);
}

run();
