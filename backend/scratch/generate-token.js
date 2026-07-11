const { generateAccessToken } = require('../src/services/authService');
require('dotenv').config();

const token = generateAccessToken({ userId: 1, role: 'admin', is_platform_admin: 1 });
console.log(token);
