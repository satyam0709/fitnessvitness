const prisma = require('../src/config/prisma');

async function testTypes() {
  try {
    console.log('--- Testing Leads query ---');
    const lead = await prisma.leads.findFirst();

    if (lead) {
      console.log('Lead found:', {
        id: lead.id,
        name: lead.name,
        status: lead.status, // enum
        amount: lead.amount, // decimal
        is_deleted: lead.is_deleted,
        created_at: lead.created_at, // datetime
      });

      console.log('Types of values:');
      console.log('- status type:', typeof lead.status, lead.status);
      console.log('- amount type:', typeof lead.amount, lead.amount);
      if (lead.amount && lead.amount.toString) {
        console.log('  amount.toString():', lead.amount.toString());
      }
      console.log('- created_at type:', typeof lead.created_at, lead.created_at instanceof Date ? 'Date object' : typeof lead.created_at);
    } else {
      console.log('No leads found to test.');
    }

    console.log('\n--- Testing Opportunities query ---');
    const opp = await prisma.opportunities.findFirst();
    if (opp) {
      console.log('Opportunity found:', {
        id: opp.id,
        title: opp.title,
        amount: opp.amount,
        stage: opp.stage,
      });
      console.log('- amount type:', typeof opp.amount, opp.amount);
      if (opp.amount && opp.amount.toString) {
        console.log('  amount.toString():', opp.amount.toString());
      }
    } else {
      console.log('No opportunities found.');
    }

    console.log('\n--- Testing Fitness Clients (Non-Money Decimals) ---');
    const client = await prisma.fitness_clients.findFirst();
    if (client) {
      console.log('Client found:', {
        client_id: client.client_id,
        full_name: client.full_name,
        height_cm: client.height_cm,
        start_weight_kg: client.start_weight_kg,
      });
      console.log('- start_weight_kg type:', typeof client.start_weight_kg, client.start_weight_kg);
      if (client.start_weight_kg && client.start_weight_kg.toNumber) {
        console.log('  start_weight_kg.toNumber():', client.start_weight_kg.toNumber());
      }
    }

    console.log('\n--- Testing Fitness Transactions (Money Decimals) ---');
    const tx = await prisma.fitness_transactions.findFirst();
    if (tx) {
      console.log('Transaction found:', {
        id: tx.id,
        product_plan: tx.product_plan,
        received_inr: tx.received_inr,
      });
      console.log('- received_inr type:', typeof tx.received_inr, tx.received_inr);
      if (tx.received_inr && tx.received_inr.toString) {
        console.log('  received_inr.toString():', tx.received_inr.toString());
      }
    }

  } catch (error) {
    console.error('Test failed with error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

testTypes();
