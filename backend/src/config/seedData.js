const prisma = require("./prisma");
const { hashPassword } = require("../services/authService");
require("dotenv").config();

const SUPERADMIN_EMAIL = process.env.SEED_SUPERADMIN_EMAIL || "iamsatyamsingh91@gmail.com";
const SUPERADMIN_PASSWORD = process.env.SEED_SUPERADMIN_PASSWORD || "Rnd@1234";

const SAMPLE_INTEGRATIONS = [
  { key: "indiamart", name: "IndiaMart", is_active: false },
  { key: "facebook", name: "Facebook Leads", is_active: false },
  { key: "website_lead", name: "Website Lead", is_active: false },
  { key: "google_ads", name: "Google Ads", is_active: false },
  { key: "99acres", name: "99Acres", is_active: false },
  { key: "housing", name: "Housing.com", is_active: false },
  { key: "magicbricks", name: "MagicBricks", is_active: false },
  { key: "tradeindia", name: "TradeIndia", is_active: false },
  { key: "just_dial", name: "JustDial", is_active: false },
  { key: "wordpress", name: "WordPress", is_active: false },
  { key: "google_form", name: "Google Form", is_active: false },
  { key: "software_suggest", name: "Software Suggest", is_active: false },
  { key: "systeme_io", name: "Systeme.io", is_active: false },
  { key: "referral", name: "Referral", is_active: false },
];

async function seedData() {
  try {
    console.log("\nStarting database seeding...\n");

    await prisma.company_settings.upsert({
      where: { id: 1 },
      create: {
        id: 1,
        company_name: process.env.SEED_COMPANY_NAME || "RND Office 365 CRM",
        website: process.env.SEED_COMPANY_WEBSITE || "https://office365-rnd-crm.example.com",
        phone: process.env.SEED_COMPANY_PHONE || "+91 90000 00000",
        email: process.env.SEED_COMPANY_EMAIL || "support@rnd-crm.example.com",
        address: process.env.SEED_COMPANY_ADDRESS || "123 RND Park, Business District",
        city: process.env.SEED_COMPANY_CITY || "Vapi",
        state: process.env.SEED_COMPANY_STATE || "Gujrat",
        country: process.env.SEED_COMPANY_COUNTRY || "India",
        gst_number: process.env.SEED_COMPANY_GST || "27AAAAA0000A1Z5",
        pan_number: process.env.SEED_COMPANY_PAN || "AAAAA0000A",
      },
      update: {
        company_name: process.env.SEED_COMPANY_NAME || "RND Office 365 CRM",
        website: process.env.SEED_COMPANY_WEBSITE || "https://office365-rnd-crm.example.com",
        phone: process.env.SEED_COMPANY_PHONE || "+91 90000 00000",
        email: process.env.SEED_COMPANY_EMAIL || "support@rnd-crm.example.com",
        address: process.env.SEED_COMPANY_ADDRESS || "123 RND Park, Business District",
        city: process.env.SEED_COMPANY_CITY || "Vapi",
        state: process.env.SEED_COMPANY_STATE || "Gujrat",
        country: process.env.SEED_COMPANY_COUNTRY || "India",
        gst_number: process.env.SEED_COMPANY_GST || "27AAAAA0000A1Z5",
        pan_number: process.env.SEED_COMPANY_PAN || "AAAAA0000A",
      },
    });
    console.log("Seeded company settings.");

    for (const integration of SAMPLE_INTEGRATIONS) {
      await prisma.integrations.upsert({
        where: { key: integration.key },
        create: {
          key: integration.key,
          name: integration.name,
          is_active: integration.is_active,
        },
        update: {
          name: integration.name,
          is_active: integration.is_active,
        },
      });
    }
    console.log("Seeded integrations.");

    if (SUPERADMIN_EMAIL && SUPERADMIN_PASSWORD) {
      const passwordHash = await hashPassword(SUPERADMIN_PASSWORD);
      await prisma.users.upsert({
        where: { email: SUPERADMIN_EMAIL },
        create: {
          email: SUPERADMIN_EMAIL,
          password_hash: passwordHash,
          first_name: "Super",
          last_name: "Admin",
          role: "admin",
          is_platform_admin: true,
          is_active: true,
          email_verified: true,
        },
        update: {
          password_hash: passwordHash,
          first_name: "Super",
          last_name: "Admin",
          role: "admin",
          is_platform_admin: true,
          is_active: true,
          email_verified: true,
        },
      });
      console.log("Seeded platform super-admin user.");
    }

    const adminClerkId = process.env.SEED_ADMIN_CLERK_USER_ID;
    const adminEmail = process.env.SEED_ADMIN_EMAIL;
    const adminFirstName = process.env.SEED_ADMIN_FIRST_NAME || "Office";
    const adminLastName = process.env.SEED_ADMIN_LAST_NAME || "Admin";

    if (adminClerkId && adminEmail) {
      const existing = await prisma.users.findFirst({
        where: { OR: [{ clerk_user_id: adminClerkId }, { email: adminEmail }] },
      });
      let adminId;
      if (existing) {
        const updated = await prisma.users.update({
          where: { id: existing.id },
          data: {
            clerk_user_id: adminClerkId,
            email: adminEmail,
            first_name: adminFirstName,
            last_name: adminLastName,
            role: "admin",
            is_active: true,
          },
        });
        adminId = updated.id;
      } else {
        const created = await prisma.users.create({
          data: {
            clerk_user_id: adminClerkId,
            email: adminEmail,
            first_name: adminFirstName,
            last_name: adminLastName,
            role: "admin",
            is_active: true,
          },
        });
        adminId = created.id;
      }
      console.log("Seeded admin user.");

      if (adminId) {
        const existingOrder = await prisma.orders.findFirst({
          where: { user_id: String(adminClerkId) },
        });
        if (!existingOrder) {
          await prisma.orders.create({
            data: {
              user_id: String(adminClerkId),
              package_name: "Platinum",
              package_price: 7800,
              currency: "INR",
              addons: [],
              subtotal: 7800,
              gst: 1404,
              total: 9204,
              status: "active",
            },
          });
        }

        const lead = await prisma.leads.create({
          data: {
            name: "Test Lead",
            company_name: "RND Solutions",
            phone: "+91 98765 43210",
            email: "lead@rnd-example.com",
            source: "indiamart",
            status: "new",
            assigned_to: adminId,
            created_by: adminId,
            notes: "Seeded lead created during database setup.",
          },
        });

        const due = new Date();
        due.setDate(due.getDate() + 7);
        await prisma.tasks.create({
          data: {
            title: "Follow up with seeded lead",
            description: "Contact the seeded lead and convert them into a customer.",
            lead_id: lead.id,
            assigned_to: adminId,
            created_by: adminId,
            due_date: due,
            priority: "high",
            status: "new",
          },
        });

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
    await prisma.$disconnect();
  }
}

seedData();
