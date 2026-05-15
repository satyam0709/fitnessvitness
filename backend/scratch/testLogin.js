const http = require('http');

const payload = JSON.stringify({
  email: "iamsatyamsingh91@gmail.com",
  password: "12345678"
});

const req = http.request({
  hostname: 'localhost',
  port: 5000,
  path: '/api/auth/login',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload)
  }
}, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log("Login Status:", res.statusCode);
    const body = JSON.parse(data);
    if (body.token) {
      console.log("Got token");
      // Now test getMe
      const meReq = http.request({
        hostname: 'localhost',
        port: 5000,
        path: '/api/auth/me',
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${body.token}`
        }
      }, (meRes) => {
        let meData = '';
        meRes.on('data', chunk => meData += chunk);
        meRes.on('end', () => {
          console.log("GetMe Status:", meRes.statusCode);
          console.log("GetMe Response:", meData);
        });
      });
      meReq.end();
    } else {
      console.log("Login failed:", body);
    }
  });
});

req.on('error', console.error);
req.write(payload);
req.end();
