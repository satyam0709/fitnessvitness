const mysql = require("mysql2/promise");
require("dotenv").config();

async function setupFitness() {
  const conn = await mysql.createConnection({
    host:     process.env.DB_HOST || "localhost",
    port:     Number(process.env.DB_PORT) || 3306,
    user:     process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || process.env.DB_PASS || "",
    database: process.env.DB_NAME || "crm_local",
    multipleStatements: false,
  });

  console.log("Setting up Fitness Vitness Tables...");

  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS fitness_settings (
        setting_key VARCHAR(100) PRIMARY KEY,
        setting_value JSON,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS fitness_clients (
        id              INT UNSIGNED  NOT NULL AUTO_INCREMENT,
        client_id       VARCHAR(20)   UNIQUE NOT NULL,
        full_name       VARCHAR(150)  NOT NULL,
        phone           VARCHAR(20)   DEFAULT NULL,
        email           VARCHAR(150)  DEFAULT NULL,
        age             INT           DEFAULT NULL,
        height_cm       DECIMAL(5,2)  DEFAULT NULL,
        start_weight_kg DECIMAL(5,2)  DEFAULT NULL,
        current_weight_kg DECIMAL(5,2) DEFAULT NULL,
        target_weight_kg DECIMAL(5,2) DEFAULT NULL,
        bmi             DECIMAL(5,2)  DEFAULT NULL,
        health_goal     VARCHAR(150)  DEFAULT NULL,
        plan_type       VARCHAR(100)  DEFAULT NULL,
        plan_start_date DATE          DEFAULT NULL,
        plan_expiry_date DATE          DEFAULT NULL,
        follow_up_freq_days INT       DEFAULT NULL,
        last_consultation_date DATE   DEFAULT NULL,
        next_due_date   DATE          DEFAULT NULL,
        tier            INT           DEFAULT 3,
        source          VARCHAR(100)  DEFAULT NULL,
        status          VARCHAR(50)   DEFAULT 'Active',
        progress        VARCHAR(50)   DEFAULT NULL,
        city            VARCHAR(100)  DEFAULT NULL,
        address         TEXT          DEFAULT NULL,
        occupation      VARCHAR(150)  DEFAULT NULL,
        emergency_contact VARCHAR(150) DEFAULT NULL,
        medical_conditions TEXT       DEFAULT NULL,
        allergies       TEXT          DEFAULT NULL,
        activity_level  VARCHAR(100)  DEFAULT NULL,
        current_medications TEXT      DEFAULT NULL,
        referred_by_client_id VARCHAR(20) DEFAULT NULL,
        coach_notes     TEXT          DEFAULT NULL,
        created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS fitness_consultations (
        id              INT UNSIGNED  NOT NULL AUTO_INCREMENT,
        client_id       VARCHAR(20)   NOT NULL,
        consult_date    DATE          NOT NULL,
        consult_type    VARCHAR(100)  NOT NULL,
        weight_kg       DECIMAL(5,2)  DEFAULT NULL,
        key_observations TEXT         DEFAULT NULL,
        diet_changes    TEXT          DEFAULT NULL,
        next_steps      TEXT          DEFAULT NULL,
        next_appointment VARCHAR(50)  DEFAULT NULL,
        created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        FOREIGN KEY (client_id) REFERENCES fitness_clients(client_id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS fitness_transactions (
        id              INT UNSIGNED  NOT NULL AUTO_INCREMENT,
        client_id       VARCHAR(20)   NOT NULL,
        transaction_date DATE         NOT NULL,
        product_plan    VARCHAR(150)  NOT NULL,
        type            VARCHAR(50)   DEFAULT NULL,
        rate_inr        DECIMAL(10,2) DEFAULT 0,
        received_inr    DECIMAL(10,2) DEFAULT 0,
        pending_inr     DECIMAL(10,2) DEFAULT 0,
        payment_due_date DATE         DEFAULT NULL,
        profit_inr      DECIMAL(10,2) DEFAULT 0,
        mode            VARCHAR(50)   DEFAULT NULL,
        created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_payment_due_date (payment_due_date),
        FOREIGN KEY (client_id) REFERENCES fitness_clients(client_id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS fitness_supplements (
        id              INT UNSIGNED  NOT NULL AUTO_INCREMENT,
        client_id       VARCHAR(20)   NOT NULL,
        product_name    VARCHAR(150)  NOT NULL,
        prescribed_date DATE          NOT NULL,
        quantity        INT           DEFAULT 1,
        mrp_inr         DECIMAL(10,2) DEFAULT 0,
        rate_inr        DECIMAL(10,2) DEFAULT 0,
        notes           TEXT          DEFAULT NULL,
        created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        FOREIGN KEY (client_id) REFERENCES fitness_clients(client_id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS fitness_body_stats (
        id              INT UNSIGNED  NOT NULL AUTO_INCREMENT,
        client_id       VARCHAR(20)   NOT NULL,
        recorded_date   DATE          NOT NULL,
        weight_kg       DECIMAL(5,2)  DEFAULT NULL,
        body_fat_pct    DECIMAL(5,2)  DEFAULT NULL,
        muscle_mass_kg  DECIMAL(5,2)  DEFAULT NULL,
        waist_cm        DECIMAL(5,2)  DEFAULT NULL,
        notes           TEXT          DEFAULT NULL,
        created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        FOREIGN KEY (client_id) REFERENCES fitness_clients(client_id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS fitness_client_tasks (
        id              INT UNSIGNED  NOT NULL AUTO_INCREMENT,
        client_id       VARCHAR(20)   NOT NULL,
        task_description VARCHAR(255) NOT NULL,
        due_date        DATE          NOT NULL,
        priority        VARCHAR(50)   DEFAULT 'Medium',
        status          VARCHAR(50)   DEFAULT 'Open',
        period          VARCHAR(50)   DEFAULT NULL,
        completed_on    DATE          DEFAULT NULL,
        notes           TEXT          DEFAULT NULL,
        created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        FOREIGN KEY (client_id) REFERENCES fitness_clients(client_id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS fitness_referrals (
        id                 INT UNSIGNED  NOT NULL AUTO_INCREMENT,
        referrer_client_id VARCHAR(20)   NOT NULL,
        referred_client_id VARCHAR(20)   NOT NULL,
        date_referred      DATE          NOT NULL,
        notes              TEXT          DEFAULT NULL,
        created_at         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        FOREIGN KEY (referrer_client_id) REFERENCES fitness_clients(client_id) ON DELETE CASCADE,
        FOREIGN KEY (referred_client_id) REFERENCES fitness_clients(client_id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    console.log("Fitness Vitness tables created successfully!");

  } catch (error) {
    console.error("Error creating fitness tables:", error);
  } finally {
    await conn.end();
  }
}

setupFitness();
