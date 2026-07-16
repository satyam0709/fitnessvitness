const { pool } = require("../src/config/database");

async function createIndex(table, indexName, definition) {
  try {
    let query = `CREATE INDEX ${indexName} ON \`${table}\` ${definition}`;
    if (definition.startsWith('UNIQUE')) {
       query = `CREATE UNIQUE INDEX ${indexName} ON \`${table}\` ${definition.replace('UNIQUE INDEX', '').trim()}`;
    }
    await pool.execute(query);
    console.log(`Created index ${table}.${indexName}`);
  } catch (err) {
    if (err.code === 'ER_DUP_KEYNAME') {
       console.log(`Index already exists for ${table}.${indexName}`);
    } else if (err.code === 'ER_NO_SUCH_TABLE') {
       console.log(`Table ${table} does not exist yet.`);
    } else {
       console.error(`Failed to create index for ${table}:`, err.message);
    }
  }
}

async function main() {
  const indexes = [
    { table: 'users', name: 'idx_email', def: '(email)' },
    { table: 'subscription_packages', name: 'uk_subscription_packages_slug', def: 'UNIQUE (slug)' },
    { table: 'subscription_addons', name: 'uk_subscription_addons_slug', def: 'UNIQUE (slug)' },
    { table: 'subscriptions', name: 'idx_subscriptions_tenant', def: '(tenant_id)' },
    { table: 'subscriptions', name: 'idx_subscriptions_status', def: '(status)' },
    { table: 'tenant_addons', name: 'idx_tenant_addons_tenant', def: '(tenant_id)' },
    { table: 'staff_permissions', name: 'idx_staff_permissions_tenant_user', def: '(tenant_id, user_id)' },
    { table: 'staff_permissions', name: 'uk_staff_permissions_scope', def: 'UNIQUE (tenant_id, user_id, permission_key)' },
    { table: 'leads', name: 'idx_leads_tenant_id', def: '(tenant_id)' },
    { table: 'tasks', name: 'idx_tasks_tenant_id', def: '(tenant_id)' },
    { table: 'reminders', name: 'idx_reminders_tenant_id', def: '(tenant_id)' },
    { table: 'meetings', name: 'idx_meetings_tenant_id', def: '(tenant_id)' },
    { table: 'notes', name: 'idx_notes_tenant_id', def: '(tenant_id)' },
    { table: 'customers', name: 'idx_customers_tenant_id', def: '(tenant_id)' },
    { table: 'invoices', name: 'idx_invoices_tenant_id', def: '(tenant_id)' },
    { table: 'crm_todos', name: 'idx_crm_todos_tenant_id', def: '(tenant_id)' }
  ];

  for (const idx of indexes) {
    await createIndex(idx.table, idx.name, idx.def);
  }
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
