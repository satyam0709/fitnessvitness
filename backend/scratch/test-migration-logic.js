const prisma = require('../src/config/prisma');
const { createClientFromOpportunity } = require('../src/services/opportunityClientService');
const { Prisma } = require('../src/generated/prisma');

async function runTests() {
  console.log('Starting migration logic tests...');
  
  try {
    // 1. Fetch all opportunities in database
    const allOpps = await prisma.opportunities.findMany();
    console.log(`\nTotal opportunities in DB: ${allOpps.length}`);
    for (const opp of allOpps) {
      console.log(`- ID: ${opp.id}, Title: ${opp.title}, Stage: ${opp.stage}, is_deleted: ${opp.is_deleted}`);
    }

    // 2. Perform test operations inside rollback transaction
    await prisma.$transaction(async (tx) => {
      console.log('\n--- Running transaction-bound verification ---');
      
      // Create a test opportunity that is NOT deleted
      const testOpp = await tx.opportunities.create({
        data: {
          title: 'Test Verification Opportunity',
          amount: new Prisma.Decimal(12500.50),
          stage: 'qualification_done',
          phone: '9876543210',
          visit_purpose: 'Wants personal training program',
          notes: 'Looking for fat loss training',
          lead_source: 'website',
          product_category: 'personal_training'
        }
      });

      console.log(`Created test opportunity: ID = ${testOpp.id}, Title = ${testOpp.title}`);
      console.log(`- Amount Type: ${typeof testOpp.amount}, Amount Value: ${testOpp.amount.toString()}`);

      // Test opportunityClientService on the created test opportunity
      console.log('Testing createClientFromOpportunity...');
      const result = await createClientFromOpportunity(tx, testOpp, 1);
      if (result) {
        console.log('Client created successfully within transaction:');
        console.log(`- Client ID: ${result.client_id}`);
        console.log(`- Full Name: ${result.row.full_name}`);
        console.log(`- Status: ${result.row.status}`);
        console.log(`- Plan Type: ${result.row.plan_type}`);
      } else {
        console.log('createClientFromOpportunity returned null (maybe fitness_clients table does not exist or was skipped).');
      }

      // Throwing error to force rollback so we don't save this test data
      throw new Error('ROLLBACK_TEST_SUCCESSFUL');
    });

  } catch (error) {
    if (error.message === 'ROLLBACK_TEST_SUCCESSFUL') {
      console.log('\nTransaction successfully rolled back as expected. Database remains clean.');
    } else {
      console.error('\nTest failed with unexpected error:', error);
    }
  } finally {
    await prisma.$disconnect();
  }
}

runTests();
