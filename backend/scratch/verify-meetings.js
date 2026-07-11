const { fork } = require('child_process');
const { generateAccessToken } = require('../src/services/authService');
require('dotenv').config();

const PORT = 5002;
const token = generateAccessToken({ userId: 1, role: 'admin', is_platform_admin: 1 });
const baseUrl = `http://localhost:${PORT}/api`;

async function runTests() {
  console.log('Generating request helper...');
  const callApi = async (path, method = 'GET', body = null) => {
    const options = {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    };
    if (body) {
      options.body = JSON.stringify(body);
    }
    const res = await fetch(`${baseUrl}${path}`, options);
    const text = await res.text();
    let data = text;
    try {
      data = JSON.parse(text);
    } catch {}
    return { status: res.status, ok: res.ok, data };
  };

  console.log('Testing GET /meetings...');
  const getRes = await callApi('/meetings');
  console.log('GET /meetings Status:', getRes.status, 'OK:', getRes.ok);
  if (!getRes.ok) throw new Error('GET /meetings failed');

  console.log('Testing GET /meetings/stats...');
  const statsRes = await callApi('/meetings/stats');
  console.log('GET /meetings/stats Status:', statsRes.status, 'OK:', statsRes.ok);
  if (!statsRes.ok) throw new Error('GET /meetings/stats failed');

  console.log('Testing GET /meetings/export...');
  const exportRes = await callApi('/meetings/export');
  console.log('GET /meetings/export Status:', exportRes.status, 'OK:', exportRes.ok);
  if (!exportRes.ok) throw new Error('GET /meetings/export failed');

  console.log('Testing POST /meetings (create)...');
  const createPayload = {
    title: 'Integration Test Meeting',
    description: 'This is a test meeting created by verify-meetings.js',
    start_time: new Date(Date.now() + 3600000).toISOString(),
    end_time: new Date(Date.now() + 7200000).toISOString(),
    location: 'Conference Room A',
    meet_link: 'https://meet.google.com/abc-defg-hij',
    meeting_type: 'virtual',
    status: 'scheduled',
    recurrence: 'once',
    assigned_to_user_id: 1,
    attendees: [1]
  };
  const createRes = await callApi('/meetings', 'POST', createPayload);
  console.log('POST /meetings Status:', createRes.status, 'OK:', createRes.ok, 'Body:', createRes.data);
  if (!createRes.ok || !createRes.data.id) throw new Error('POST /meetings failed');
  const meetingId = createRes.data.id;

  console.log(`Testing PUT /meetings/${meetingId} (update)...`);
  const updatePayload = {
    title: 'Updated Integration Test Meeting',
    description: 'This meeting was updated',
    start_time: new Date(Date.now() + 3600000).toISOString(),
    assigned_to_user_id: 1,
    attendees: [1]
  };
  const updateRes = await callApi(`/meetings/${meetingId}`, 'PUT', updatePayload);
  console.log('PUT /meetings Status:', updateRes.status, 'OK:', updateRes.ok);
  if (!updateRes.ok) throw new Error('PUT /meetings failed');

  console.log('Testing POST /meetings/bulk-assign...');
  const bulkAssignRes = await callApi('/meetings/bulk-assign', 'POST', {
    ids: [meetingId],
    assigned_to_user_id: 1
  });
  console.log('POST /meetings/bulk-assign Status:', bulkAssignRes.status, 'OK:', bulkAssignRes.ok);
  if (!bulkAssignRes.ok) throw new Error('POST /meetings/bulk-assign failed');

  console.log('Testing POST /meetings/bulk-delete...');
  const bulkDeleteRes = await callApi('/meetings/bulk-delete', 'POST', {
    ids: [meetingId]
  });
  console.log('POST /meetings/bulk-delete Status:', bulkDeleteRes.status, 'OK:', bulkDeleteRes.ok);
  if (!bulkDeleteRes.ok) throw new Error('POST /meetings/bulk-delete failed');

  console.log('Testing DELETE /meetings/:id...');
  const newMeetingRes = await callApi('/meetings', 'POST', createPayload);
  const newMeetingId = newMeetingRes.data.id;
  const deleteRes = await callApi(`/meetings/${newMeetingId}`, 'DELETE');
  console.log('DELETE /meetings Status:', deleteRes.status, 'OK:', deleteRes.ok);
  if (!deleteRes.ok) throw new Error('DELETE /meetings failed');

  console.log('\n======================================');
  console.log('🎉 ALL MEETINGS ROUTE TESTS PASSED 🎉');
  console.log('======================================\n');
}

console.log('Starting backend server on port', PORT);
const serverProc = fork('./src/server.js', [], {
  env: { ...process.env, PORT },
  silent: false
});

setTimeout(async () => {
  try {
    await runTests();
    serverProc.kill();
    process.exit(0);
  } catch (err) {
    console.error('Test run failed:', err);
    serverProc.kill();
    process.exit(1);
  }
}, 15000);
