const { mainPool: pool } = require("./database");
const { hashPassword } = require("../services/authService");
require("dotenv").config();

const SUPERADMIN_EMAIL = process.env.SEED_SUPERADMIN_EMAIL || "iamsatyamsingh91@gmail.com";
const SUPERADMIN_PASSWORD = process.env.SEED_SUPERADMIN_PASSWORD || "Rnd@1234";

const SAMPLE_INTEGRATIONS = [
  { key: "indiamart", name: "IndiaMart", is_active: 0 },
  { key: "facebook", name: "Facebook Leads", is_active: 0 },
  { key: "website_lead", name: "Website Lead", is_active: 0 },
  { key: "google_ads", name: "Google Ads", is_active: 0 },
  { key: "99acres", name: "99Acres", is_active: 0 },
  { key: "housing", name: "Housing.com", is_active: 0 },
  { key: "magicbricks", name: "MagicBricks", is_active: 0 },
  { key: "tradeindia", name: "TradeIndia", is_active: 0 },
  { key: "just_dial", name: "JustDial", is_active: 0 },
  { key: "wordpress", name: "WordPress", is_active: 0 },
  { key: "google_form", name: "Google Form", is_active: 0 },
  { key: "software_suggest", name: "Software Suggest", is_active: 0 },
  { key: "systeme_io", name: "Systeme.io", is_active: 0 },
  { key: "referral", name: "Referral", is_active: 0 },
];

async function seedData() {
  try {
    console.log("\nStarting database seeding...\n");

    await pool.execute(
      `INSERT INTO company_settings (id, company_name, website, phone, email, address, city, state, country, gst_number, pan_number)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         company_name = VALUES(company_name),
         website = VALUES(website),
         phone = VALUES(phone),
         email = VALUES(email),
         address = VALUES(address),
         city = VALUES(city),
         state = VALUES(state),
         country = VALUES(country),
         gst_number = VALUES(gst_number),
         pan_number = VALUES(pan_number)`,
      [
        process.env.SEED_COMPANY_NAME || "RND Office 365 CRM",
        process.env.SEED_COMPANY_WEBSITE || "https://office365-rnd-crm.example.com",
        process.env.SEED_COMPANY_PHONE || "+91 90000 00000",
        process.env.SEED_COMPANY_EMAIL || "support@rnd-crm.example.com",
        process.env.SEED_COMPANY_ADDRESS || "123 RND Park, Business District",
        process.env.SEED_COMPANY_CITY || "Vapi",
        process.env.SEED_COMPANY_STATE || "Gujrat",
        process.env.SEED_COMPANY_COUNTRY || "India",
        process.env.SEED_COMPANY_GST || "27AAAAA0000A1Z5",
        process.env.SEED_COMPANY_PAN || "AAAAA0000A",
      ]
    );
    console.log("Seeded company settings.");

    for (const integration of SAMPLE_INTEGRATIONS) {
      await pool.execute(
        `INSERT INTO integrations (` + "`key`" + `, name, is_active
         ) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE
           name = VALUES(name),
           is_active = VALUES(is_active)`,
        [integration.key, integration.name, integration.is_active]
      );
    }
    console.log("Seeded integrations.");

    if (SUPERADMIN_EMAIL && SUPERADMIN_PASSWORD) {
      const passwordHash = await hashPassword(SUPERADMIN_PASSWORD);
      await pool.execute(
        `INSERT INTO users (email, password_hash, first_name, last_name, role, tenant_id, is_platform_admin, is_active, email_verified)
         VALUES (?, ?, ?, ?, 'admin', NULL, 1, 1, 1)
         ON DUPLICATE KEY UPDATE
           password_hash = VALUES(password_hash),
           first_name = VALUES(first_name),
           last_name = VALUES(last_name),
           role = VALUES(role),
           tenant_id = VALUES(tenant_id),
           is_platform_admin = VALUES(is_platform_admin),
           is_active = VALUES(is_active),
           email_verified = VALUES(email_verified)`,
        [SUPERADMIN_EMAIL, passwordHash, "Super", "Admin"]
      );
      console.log("Seeded platform super-admin user.");
    }

    const adminClerkId = process.env.SEED_ADMIN_CLERK_USER_ID;
    const adminEmail = process.env.SEED_ADMIN_EMAIL;
    const adminFirstName = process.env.SEED_ADMIN_FIRST_NAME || "Office";
    const adminLastName = process.env.SEED_ADMIN_LAST_NAME || "Admin";

    if (adminClerkId && adminEmail) {
      await pool.execute(
        `INSERT INTO users (clerk_user_id, email, first_name, last_name, role, is_active)
         VALUES (?, ?, ?, ?, 'admin', 1)
         ON DUPLICATE KEY UPDATE
           email = VALUES(email),
           first_name = VALUES(first_name),
           last_name = VALUES(last_name),
           role = VALUES(role),
           is_active = VALUES(is_active)`,
        [adminClerkId, adminEmail, adminFirstName, adminLastName]
      );
      console.log("Seeded admin user.");

      const [[adminRow]] = await pool.execute(
        "SELECT id FROM users WHERE clerk_user_id = ? LIMIT 1",
        [adminClerkId]
      );

      if (adminRow?.id) {
        const adminId = adminRow.id;

        await pool.execute(
          `INSERT INTO orders (user_id, package_name, package_price, currency, addons, subtotal, gst, total, status)
           VALUES (?, 'Platinum', 7800, 'INR', '[]', 7800, 1404, 9204, 'active')
           ON DUPLICATE KEY UPDATE status = VALUES(status), package_name = VALUES(package_name), total = VALUES(total)`,
          [adminClerkId]
        );

        await pool.execute(
          `INSERT INTO leads (name, company_name, phone, email, source, status, assigned_to, created_by, notes)
           VALUES (?, ?, ?, ?, 'indiamart', 'new', ?, ?, ?)`,
          [
            "Test Lead",
            "RND Solutions",
            "+91 98765 43210",
            "lead@rnd-example.com",
            adminId,
            adminId,
            "Seeded lead created during database setup.",
          ]
        );

        await pool.execute(
          `INSERT INTO tasks (title, description, lead_id, assigned_to, created_by, due_date, priority, status)
           VALUES (?, ?, (SELECT id FROM leads WHERE created_by = ? ORDER BY created_at DESC LIMIT 1), ?, ?, DATE_ADD(CURDATE(), INTERVAL 7 DAY), 'high', 'new')`,
          [
            "Follow up with seeded lead",
            "Contact the seeded lead and convert them into a customer.",
            adminId,
            adminId,
            adminId,
          ]
        );

        console.log("Seeded admin order, lead, and task.");
      }
    } else {
      console.log("No admin seed env variables found. Skipping admin user seed.");
    }

    console.log("\nDatabase seeding completed successfully.\n");
  } catch (err) {
    console.error("Seeding error:", err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

seedData();
