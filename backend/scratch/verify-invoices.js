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
      console.log('Testing GET /v2/invoices...');
      const getInit = await request('GET', '/v2/invoices');
      console.log('GET /v2/invoices Status:', getInit.status);
      if (getInit.status !== 200 || !getInit.body.success) {
        throw new Error('GET /v2/invoices init failed');
      }

      console.log('Testing POST /v2/invoices...');
      const postRes = await request('POST', '/v2/invoices', {
        type: 'sales',
        customer_name: 'John Doe',
        customer_email: 'john@example.com',
        invoice_date: '2026-07-10',
        subtotal: 1000.50,
        tax: 180.09,
        total: 1180.59,
        status: 'draft',
        notes: 'Test invoice notes',
        line_items_json: JSON.stringify([{ product_name: 'Consultation', qty: 1, cost: 1000.50 }])
      });
      console.log('POST /v2/invoices Status:', postRes.status, 'Body:', postRes.body);
      if (postRes.status !== 200 || !postRes.body.success) {
        throw new Error('POST /v2/invoices failed');
      }
      const createdId = postRes.body.id;

      console.log('Testing GET /v2/invoices/:id...');
      const getById = await request('GET', `/v2/invoices/${createdId}`);
      console.log('GET /v2/invoices/:id Status:', getById.status, 'Body:', getById.body);
      if (getById.status !== 200 || !getById.body.success) {
        throw new Error('GET /v2/invoices/:id failed');
      }
      // Check Decimal string formatting
      const inv = getById.body.invoice;
      if (Math.abs(Number(inv.subtotal) - 1000.50) > 0.001 || Math.abs(Number(inv.tax) - 180.09) > 0.001 || Math.abs(Number(inv.total) - 1180.59) > 0.001) {
        throw new Error(`Decimal string formatting incorrect: subtotal=${inv.subtotal}, tax=${inv.tax}, total=${inv.total}`);
      }

      console.log('Testing GET /v2/invoices/:id/receipt (PDF)...');
      const getReceipt = await request('GET', `/v2/invoices/${createdId}/receipt`);
      console.log('GET /v2/invoices/:id/receipt Status:', getReceipt.status);
      if (getReceipt.status !== 200 || !getReceipt.body.success) {
        throw new Error('GET /v2/invoices/:id/receipt failed');
      }

      console.log('Testing PATCH /v2/invoices/:id/status...');
      const patchRes = await request('PATCH', `/v2/invoices/${createdId}/status`, { status: 'sent' });
      console.log('PATCH /v2/invoices/:id/status Status:', patchRes.status);
      if (patchRes.status !== 200 || !patchRes.body.success) {
        throw new Error('PATCH /v2/invoicesStatus failed');
      }

      console.log('Testing DELETE /v2/invoices/:id...');
      const delRes = await request('DELETE', `/v2/invoices/${createdId}`);
      console.log('DELETE /v2/invoices/:id Status:', delRes.status);
      if (delRes.status !== 200 || !delRes.body.success) {
        throw new Error('DELETE /v2/invoices failed');
      }

      console.log('\n==========================================');
      console.log('🎉 ALL INVOICES ROUTE TESTS PASSED 🎉');
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
