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
      console.log('Testing GET /collections/summary...');
      const getSummary = await request('GET', '/collections/summary');
      console.log('GET /collections/summary Status:', getSummary.status, 'Body:', getSummary.body);
      if (getSummary.status !== 200 || !getSummary.body.success) {
        throw new Error('GET /collections/summary failed');
      }

      console.log('Testing POST /collections (create)...');
      const createRes = await request('POST', '/collections', {
        external_buyer: {
          full_name: 'Test Walkin Customer',
          phone: '9998887770',
          notes: 'Walk-in customer notes'
        },
        lines: [
          {
            collection_type: 'diet_plan',
            title: 'diet Plan',
            total_inr: 3000.00,
            paid_now_inr: 1000.00,
            next_followup_date: '2026-07-15'
          }
        ],
        notes: 'Main collection notes'
      });
      console.log('POST /collections Status:', createRes.status, 'Body:', createRes.body);
      if (createRes.status !== 201 || !createRes.body.success) {
        throw new Error('POST /collections failed');
      }
      const createdId = createRes.body.data[0].id;

      console.log('Testing GET /collections/:id...');
      const getOne = await request('GET', `/collections/${createdId}`);
      console.log('GET /collections/:id Status:', getOne.status, 'Body:', getOne.body);
      if (getOne.status !== 200 || !getOne.body.success) {
        throw new Error('GET /collections/:id failed');
      }
      // Assert decimal values are strings
      const col = getOne.body.data;
      if (typeof col.total_inr !== 'string' || typeof col.received_inr !== 'string' || typeof col.pending_inr !== 'string') {
        throw new Error(`Collection decimal fields are not strings: total=${typeof col.total_inr}, received=${typeof col.received_inr}, pending=${typeof col.pending_inr}`);
      }

      console.log('Testing POST /collections/:id/payments (add payment)...');
      const payRes = await request('POST', `/collections/${createdId}/payments`, {
        amount_inr: 1000.00,
        pay_mode: 'GPay',
        notes: 'Second installment'
      });
      console.log('POST /collections/:id/payments Status:', payRes.status, 'Body:', payRes.body);
      if (payRes.status !== 200 || !payRes.body.success) {
        throw new Error('POST /collections/:id/payments failed');
      }

      console.log('Testing PATCH /collections/:id (update followup)...');
      const patchRes = await request('PATCH', `/collections/${createdId}`, {
        next_followup_date: '2026-07-25'
      });
      console.log('PATCH /collections/:id Status:', patchRes.status, 'Body:', patchRes.body);
      if (patchRes.status !== 200 || !patchRes.body.success) {
        throw new Error('PATCH /collections/:id failed');
      }

      console.log('Testing POST /collections/:id/mark-paid...');
      const markPaidRes = await request('POST', `/collections/${createdId}/mark-paid`, {
        pay_mode: 'UPI',
        notes: 'Final settlement'
      });
      console.log('POST /collections/:id/mark-paid Status:', markPaidRes.status, 'Body:', markPaidRes.body);
      if (markPaidRes.status !== 200 || !markPaidRes.body.success) {
        throw new Error('POST /collections/:id/mark-paid failed');
      }

      console.log('\n==========================================');
      console.log('🎉 ALL COLLECTIONS ROUTE TESTS PASSED 🎉');
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
