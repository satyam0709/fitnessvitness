const { mainPool } = require("../src/config/database");

async function checkConstraint() {
  try {
    const [rows] = await mainPool.execute(`
      SELECT 
        CONSTRAINT_NAME, DELETE_RULE, UPDATE_RULE 
      FROM information_schema.REFERENTIAL_CONSTRAINTS 
      WHERE CONSTRAINT_SCHEMA = 'defaultdb' 
        AND CONSTRAINT_NAME = 'fk_feb_referred_client'
    `);
    console.log("CONSTRAINT QUERY RESULTS:", JSON.stringify(rows, null, 2));
  } catch (err) {
    console.error("Query failed:", err.message);
  } finally {
    process.exit(0);
  }
}

checkConstraint();
