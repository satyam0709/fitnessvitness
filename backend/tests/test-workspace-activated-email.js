/**
 * Test script for sendWorkspaceActivatedEmail function
 * 
 * Usage: 
 *   node tests/test-workspace-activated-email.js
 * 
 * This validates the email function works without errors
 */

require('dotenv').config();

const { sendWorkspaceActivatedEmail } = require('../src/services/emailService');

async function runTests() {
  console.log('🧪 Testing sendWorkspaceActivatedEmail function...\n');

  // Test 1: Free Trial Email
  console.log('📧 Test 1: Free Trial Activation Email');
  console.log('─'.repeat(50));
  const trialResult = await sendWorkspaceActivatedEmail('user@example.com', {
    firstName: 'John',
    companyName: 'Acme Corp',
    tenantUrl: 'https://acme.365rndcrm.vercel.app',
    packageName: 'Professional Plan',
    paymentType: 'trial',
    loginEmail: 'user@example.com',
  });

  console.log('Result:', trialResult.ok ? '✅ PASS' : '❌ FAIL');
  if (!trialResult.ok) {
    console.error('Error:', trialResult.reason, trialResult.detail);
  } else {\n    console.log('Channel:', trialResult.channel);\n  }\n\n  // Test 2: Paid Email\n  console.log('📧 Test 2: Paid Payment Activation Email');\n  console.log('─'.repeat(50));\n  const paidResult = await sendWorkspaceActivatedEmail('client@company.com', {\n    firstName: 'Sarah',\n    companyName: 'TechCorp Ltd',\n    tenantUrl: 'https://techcorp.365rndcrm.vercel.app',\n    packageName: 'Enterprise Plan',\n    paymentType: 'paid',\n    loginEmail: 'client@company.com',\n  });\n\n  console.log('Result:', paidResult.ok ? '✅ PASS' : '❌ FAIL');\n  if (!paidResult.ok) {\n    console.error('Error:', paidResult.reason, paidResult.detail);\n  } else {\n    console.log('Channel:', paidResult.channel);\n  }\n\n  // Test 3: Missing email (should fail gracefully)\n  console.log('\\n📧 Test 3: Missing Email (Error Handling)');\n  console.log('─'.repeat(50));\n  const failResult = await sendWorkspaceActivatedEmail('', {\n    firstName: 'Test',\n    companyName: 'Test Company',\n    tenantUrl: 'https://test.365rndcrm.vercel.app',\n    packageName: 'Test Plan',\n  });\n\n  console.log('Result:', !failResult.ok ? '✅ PASS (correctly rejected)' : '❌ FAIL');\n  console.log('Error reason:', failResult.reason);\n\n  console.log('\\n' + '═'.repeat(50));\n  console.log('✨ All tests completed!');\n  console.log('\\nNote: If SMTP is not configured, emails fall back to webhook.');\n  console.log('Check logs for \"SMTP ready\" or webhook delivery status.');\n  process.exit(0);\n}\n\nrunTests().catch(err => {\n  console.error('❌ Test failed with error:', err.message);\n  process.exit(1);\n});\n