require("dotenv").config();
const { pool } = require("../src/config/database");
const collectionService = require("../src/services/collectionService");

async function main() {
  const [clients] = await pool.execute(
    "SELECT client_id FROM fitness_clients LIMIT 1"
  );
  if (!clients.length) {
    console.error("No clients in DB");
    process.exit(1);
  }
  const clientId = clients[0].client_id;
  console.log("Using client", clientId);

  const req = {
    user: { id: 2, role: "owner" },
    body: {
      client_id: clientId,
      lines: [
        {
          collection_type: "diet_plan",
          title: "Test diet plan",
          total_inr: 5000,
          paid_now_inr: 2000,
        },
      ],
      next_followup_date: "2026-05-20",
      pay_mode: "GPay",
      transaction_date: "2026-05-16",
    },
  };

  try {
    const created = await collectionService.createCollectionsFromVisit(req);
    console.log("OK", created.length, created[0]?.id);
  } catch (e) {
    console.error("FAIL:", e.message);
    console.error(e.stack);
  }
  process.exit(0);
}

main();
