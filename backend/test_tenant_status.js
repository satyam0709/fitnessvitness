const { mainPool } = require("./src/config/database");

async function testTenantStatusMigration() {
  try {
    console.log("Testing tenant status migration...");
    
    // Check if the ENUM includes 'pending_payment'
    const [enumRows] = await mainPool.execute(`
      SELECT COLUMN_TYPE 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'tenants' 
        AND COLUMN_NAME = 'status'
    `);
    
    if (enumRows.length > 0) {
      const columnType = enumRows[0].COLUMN_TYPE;
      console.log("Current tenants.status ENUM:", columnType);
      
      if (columnType.includes("'pending_payment'")) {
        console.log("✓ ENUM successfully includes 'pending_payment'");
      } else {
        console.log("✗ ENUM does not include 'pending_payment'");
      }
    } else {
      console.log("✗ Could not find tenants.status column");
    }
    
    // Test creating a tenant with pending_payment status
    const testTenantId = 'test-pending-payment-' + Date.now();
    try {
      await mainPool.execute(
        `INSERT INTO tenants (id, company_name, owner_user_id, status, trial_ends_at) 
         VALUES (?, ?, ?, 'pending_payment', DATE_ADD(NOW(), INTERVAL 7 DAY))`,
        [testTenantId, 'Test Pending Payment Tenant', 1]
      );
      console.log("✓ Successfully created tenant with status 'pending_payment'");
      
      // Clean up
      await mainPool.execute(`DELETE FROM tenants WHERE id = ?`, [testTenantId]);
      console.log("✓ Cleaned up test tenant");
    } catch (insertError) {
      console.log("✗ Error creating tenant with 'pending_payment':", insertError.message);
    }
    
  } catch (error) {
    console.error("Test failed:", error);
  } finally {
    process.exit(0);
  }
}

testTenantStatusMigration();