const { generateAccessToken } = require('../src/services/authService');
const http = require('http');

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

  console.log('Starting backend server on port', PORT);
  const server = fork('./src/server.js', [], {
    env: { ...process.env, PORT },
    silent: false
  });

  setTimeout(async () => {
    try {
      console.log('Testing GET /todos (initially empty or pre-existing)...');
      const getInit = await request('GET', '/todos');
      console.log('GET /todos Status:', getInit.status);
      if (getInit.status !== 200 || !getInit.body.success) {
        throw new Error('GET /todos init failed');
      }

      console.log('Testing POST /todos (create)...');
      const postRes = await request('POST', '/todos', {
        body: 'Integration Test Todo Item',
        priority: 'high',
        todo_date: '2026-07-10',
        frequency: 'once',
        carry_forward: true,
        assignee_ids: [1]
      });
      console.log('POST /todos Status:', postRes.status, 'Body:', postRes.body);
      if (postRes.status !== 201 || !postRes.body.success) {
        throw new Error('POST /todos failed');
      }
      const createdId = postRes.body.data.id;

      console.log('Testing PUT /todos/:id (update status and priority)...');
      const putRes = await request('PUT', `/todos/${createdId}`, {
        body: 'Updated Integration Test Todo Item',
        priority: 'medium',
        status: 'completed',
        assignee_ids: [1]
      });
      console.log('PUT /todos/:id Status:', putRes.status, 'Body:', putRes.body);
      if (putRes.status !== 200 || !putRes.body.success) {
        throw new Error('PUT /todos failed');
      }

      console.log('Testing DELETE /todos/:id (soft-delete)...');
      const delRes = await request('DELETE', `/todos/${createdId}`);
      console.log('DELETE /todos/:id Status:', delRes.status, 'Body:', delRes.body);
      if (delRes.status !== 200 || !delRes.body.success) {
        throw new Error('DELETE /todos failed');
      }

      console.log('\n==========================================');
      console.log('🎉 ALL CRM TODOS ROUTE TESTS PASSED 🎉');
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
