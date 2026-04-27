-- Finance Tracker Database Schema
-- PostgreSQL

-- ============================================
-- ACCOUNTS: Bank accounts & credit cards
-- ============================================
CREATE TABLE IF NOT EXISTS accounts (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(100) NOT NULL,          -- "ICICI Savings", "Utkarsh SuperCard"
    type            VARCHAR(20) NOT NULL DEFAULT 'bank',  -- 'bank', 'credit_card', 'wallet'
    last_four       VARCHAR(4),                     -- Last 4 digits: "0158", "9413"
    bank_name       VARCHAR(100),                   -- "ICICI Bank", "Utkarsh SFBL"
    sms_sender_id   VARCHAR(50),                    -- "AX-ICICIT-S", "JK-UTKSPR-S"
    is_active       BOOLEAN DEFAULT true,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- CATEGORIES: Two-level category tree
-- ============================================
CREATE TABLE IF NOT EXISTS categories (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(100) NOT NULL,
    icon            VARCHAR(10),                    -- Emoji icon
    parent_id       INTEGER REFERENCES categories(id) ON DELETE CASCADE,
    is_active       BOOLEAN DEFAULT true,
    sort_order      INTEGER DEFAULT 0,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- CONTACTS: People & merchants
-- ============================================
CREATE TABLE IF NOT EXISTS contacts (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(200) NOT NULL,
    type            VARCHAR(20) DEFAULT 'merchant', -- 'person', 'merchant', 'employer'
    relationship    VARCHAR(30),                    -- 'friend', 'family', 'employer', 'merchant'
    upi_ids         TEXT[] DEFAULT '{}',            -- Array of UPI IDs
    account_numbers TEXT[] DEFAULT '{}',            -- Array of account numbers
    default_category_id    INTEGER REFERENCES categories(id),
    default_subcategory_id INTEGER REFERENCES categories(id),
    notes           TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- TRANSACTIONS: All debits & credits
-- ============================================
CREATE TABLE IF NOT EXISTS transactions (
    id                      SERIAL PRIMARY KEY,
    external_id             VARCHAR(100) UNIQUE,    -- For dedup from mobile sync
    account_id              INTEGER REFERENCES accounts(id),
    type                    VARCHAR(20) NOT NULL,   -- 'debit', 'credit', 'cc_spend', 'cc_repayment'
    amount                  DECIMAL(12,2) NOT NULL,
    transaction_date        TIMESTAMPTZ NOT NULL,
    description             TEXT,
    merchant_name           VARCHAR(200),
    upi_ref                 VARCHAR(50),
    contact_id              INTEGER REFERENCES contacts(id),
    category_id             INTEGER REFERENCES categories(id),
    subcategory_id          INTEGER REFERENCES categories(id),
    is_classified           BOOLEAN DEFAULT false,
    classification_method   VARCHAR(30),            -- 'manual', 'auto_exact', 'auto_fuzzy', 'auto_contact'
    classification_confidence DECIMAL(3,2),
    is_split                BOOLEAN DEFAULT false,
    is_loan                 BOOLEAN DEFAULT false,
    loan_type               VARCHAR(10),            -- 'given', 'received', 'repayment'
    is_credit_card_repayment BOOLEAN DEFAULT false,
    special_flag            VARCHAR(50),            -- 'one_off', 'recurring', null
    special_flag_note       TEXT,
    notes                   TEXT,
    raw_sms                 TEXT,
    source                  VARCHAR(10) DEFAULT 'sms', -- 'sms', 'pdf', 'manual'
    available_balance       DECIMAL(12,2),
    available_credit_limit  DECIMAL(12,2),
    created_at              TIMESTAMPTZ DEFAULT NOW(),
    updated_at              TIMESTAMPTZ DEFAULT NOW(),
    synced_at               TIMESTAMPTZ
);

-- ============================================
-- CLASSIFICATION RULES: Self-learning memory
-- ============================================
CREATE TABLE IF NOT EXISTS classification_rules (
    id              SERIAL PRIMARY KEY,
    match_type      VARCHAR(30) NOT NULL,           -- 'exact_merchant', 'upi_id', 'contact', 'fuzzy'
    match_value     VARCHAR(300) NOT NULL,           -- The merchant name / UPI ID to match
    category_id     INTEGER REFERENCES categories(id),
    subcategory_id  INTEGER REFERENCES categories(id),
    confidence      DECIMAL(3,2) DEFAULT 0.50,
    hit_count       INTEGER DEFAULT 1,
    total_classifications INTEGER DEFAULT 1,         -- For consistency tracking
    consistent_classifications INTEGER DEFAULT 1,    -- Same category hit count
    last_used       TIMESTAMPTZ DEFAULT NOW(),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(match_type, match_value)
);

-- ============================================
-- SPLITS: Split expense tracking
-- ============================================
CREATE TABLE IF NOT EXISTS splits (
    id                      SERIAL PRIMARY KEY,
    transaction_id          INTEGER NOT NULL REFERENCES transactions(id),
    total_amount            DECIMAL(12,2) NOT NULL,
    my_share                DECIMAL(12,2) NOT NULL,
    is_fully_settled        BOOLEAN DEFAULT false,
    notes                   TEXT,
    created_at              TIMESTAMPTZ DEFAULT NOW(),
    updated_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS split_participants (
    id              SERIAL PRIMARY KEY,
    split_id        INTEGER NOT NULL REFERENCES splits(id) ON DELETE CASCADE,
    contact_id      INTEGER REFERENCES contacts(id),
    contact_name    VARCHAR(200),                   -- Fallback if no contact record
    amount          DECIMAL(12,2) NOT NULL,
    is_settled      BOOLEAN DEFAULT false,
    settled_transaction_id  INTEGER REFERENCES transactions(id), -- Link to repayment
    settled_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- INCOME SOURCES
-- ============================================
CREATE TABLE IF NOT EXISTS income_sources (
    id              SERIAL PRIMARY KEY,
    contact_id      INTEGER REFERENCES contacts(id),
    source_type     VARCHAR(30) NOT NULL,           -- 'salary', 'family', 'freelance', 'refund', 'interest', 'other'
    description     TEXT,
    is_recurring    BOOLEAN DEFAULT false,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- APP LOGS: Structured application logs
-- ============================================
CREATE TABLE IF NOT EXISTS app_logs (
    id              SERIAL PRIMARY KEY,
    level           VARCHAR(10) NOT NULL,
    module          VARCHAR(50),
    action          VARCHAR(100),
    message         TEXT,
    details         JSONB,
    device_id       VARCHAR(100),
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- SYNC LOG: Track mobile ↔ VPS sync state
-- ============================================
CREATE TABLE IF NOT EXISTS sync_log (
    id              SERIAL PRIMARY KEY,
    device_id       VARCHAR(100) NOT NULL,
    table_name      VARCHAR(50) NOT NULL,
    last_sync_at    TIMESTAMPTZ NOT NULL,
    records_synced  INTEGER DEFAULT 0,
    direction       VARCHAR(10) DEFAULT 'push',     -- 'push', 'pull'
    status          VARCHAR(20) DEFAULT 'success',  -- 'success', 'partial', 'failed'
    error_message   TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- INDEXES
-- ============================================
CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(transaction_date);
CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category_id);
CREATE INDEX IF NOT EXISTS idx_transactions_classified ON transactions(is_classified);
CREATE INDEX IF NOT EXISTS idx_transactions_upi_ref ON transactions(upi_ref);
CREATE INDEX IF NOT EXISTS idx_transactions_merchant ON transactions(merchant_name);
CREATE INDEX IF NOT EXISTS idx_transactions_synced ON transactions(synced_at);
CREATE INDEX IF NOT EXISTS idx_classification_rules_match ON classification_rules(match_type, match_value);
CREATE INDEX IF NOT EXISTS idx_contacts_name ON contacts(name);
CREATE INDEX IF NOT EXISTS idx_app_logs_created ON app_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_categories_parent ON categories(parent_id);

-- ============================================
-- DEFAULT CATEGORIES (seed data)
-- ============================================
INSERT INTO categories (name, icon, parent_id, sort_order) VALUES
    ('Food', '🍔', NULL, 1),
    ('Transport', '🚗', NULL, 2),
    ('Shopping', '🛒', NULL, 3),
    ('Bills & Utilities', '💡', NULL, 4),
    ('Entertainment', '🎬', NULL, 5),
    ('Health', '🏥', NULL, 6),
    ('Education', '📚', NULL, 7),
    ('Financial', '💰', NULL, 8),
    ('Personal', '👤', NULL, 9),
    ('Rent & Housing', '🏠', NULL, 10),
    ('Credit Card', '💳', NULL, 11),
    ('Income', '💼', NULL, 12)
ON CONFLICT DO NOTHING;

-- Sub-categories (using subquery for parent_id lookup)
-- Food sub-categories
INSERT INTO categories (name, icon, parent_id, sort_order)
SELECT name, icon, (SELECT id FROM categories WHERE name = 'Food' AND parent_id IS NULL), sort_order
FROM (VALUES
    ('Restaurants', '🍽️', 1), ('Groceries', '🥬', 2), ('Snacks', '🍿', 3),
    ('Beverages', '☕', 4), ('Food Delivery', '🛵', 5)
) AS t(name, icon, sort_order)
ON CONFLICT DO NOTHING;

-- Transport sub-categories
INSERT INTO categories (name, icon, parent_id, sort_order)
SELECT name, icon, (SELECT id FROM categories WHERE name = 'Transport' AND parent_id IS NULL), sort_order
FROM (VALUES
    ('Fuel', '⛽', 1), ('Auto/Cab', '🛺', 2), ('Public Transport', '🚌', 3), ('Parking', '🅿️', 4)
) AS t(name, icon, sort_order)
ON CONFLICT DO NOTHING;

-- Shopping sub-categories
INSERT INTO categories (name, icon, parent_id, sort_order)
SELECT name, icon, (SELECT id FROM categories WHERE name = 'Shopping' AND parent_id IS NULL), sort_order
FROM (VALUES
    ('Clothing', '👕', 1), ('Electronics', '📱', 2), ('Home & Living', '🏡', 3), ('Personal Care', '🧴', 4)
) AS t(name, icon, sort_order)
ON CONFLICT DO NOTHING;

-- Bills & Utilities sub-categories
INSERT INTO categories (name, icon, parent_id, sort_order)
SELECT name, icon, (SELECT id FROM categories WHERE name = 'Bills & Utilities' AND parent_id IS NULL), sort_order
FROM (VALUES
    ('Electricity', '⚡', 1), ('Water', '💧', 2), ('Internet', '🌐', 3),
    ('Phone', '📞', 4), ('Gas', '🔥', 5)
) AS t(name, icon, sort_order)
ON CONFLICT DO NOTHING;

-- Entertainment sub-categories
INSERT INTO categories (name, icon, parent_id, sort_order)
SELECT name, icon, (SELECT id FROM categories WHERE name = 'Entertainment' AND parent_id IS NULL), sort_order
FROM (VALUES
    ('Movies', '🎥', 1), ('Games', '🎮', 2), ('Subscriptions', '📺', 3),
    ('Events', '🎉', 4), ('Outings', '🎡', 5)
) AS t(name, icon, sort_order)
ON CONFLICT DO NOTHING;

-- Health sub-categories
INSERT INTO categories (name, icon, parent_id, sort_order)
SELECT name, icon, (SELECT id FROM categories WHERE name = 'Health' AND parent_id IS NULL), sort_order
FROM (VALUES
    ('Medical', '🩺', 1), ('Pharmacy', '💊', 2), ('Gym', '💪', 3), ('Insurance', '🛡️', 4)
) AS t(name, icon, sort_order)
ON CONFLICT DO NOTHING;

-- Education sub-categories
INSERT INTO categories (name, icon, parent_id, sort_order)
SELECT name, icon, (SELECT id FROM categories WHERE name = 'Education' AND parent_id IS NULL), sort_order
FROM (VALUES
    ('Courses', '🎓', 1), ('Books', '📖', 2), ('Stationery', '✏️', 3)
) AS t(name, icon, sort_order)
ON CONFLICT DO NOTHING;

-- Financial sub-categories
INSERT INTO categories (name, icon, parent_id, sort_order)
SELECT name, icon, (SELECT id FROM categories WHERE name = 'Financial' AND parent_id IS NULL), sort_order
FROM (VALUES
    ('Loans', '🏦', 1), ('EMI', '📆', 2), ('Insurance Premium', '📋', 3),
    ('Investments', '📈', 4), ('Bank Charges', '🏧', 5)
) AS t(name, icon, sort_order)
ON CONFLICT DO NOTHING;

-- Personal sub-categories
INSERT INTO categories (name, icon, parent_id, sort_order)
SELECT name, icon, (SELECT id FROM categories WHERE name = 'Personal' AND parent_id IS NULL), sort_order
FROM (VALUES
    ('Gifts', '🎁', 1), ('Donations', '🤲', 2), ('Grooming', '💈', 3), ('Miscellaneous', '📦', 4)
) AS t(name, icon, sort_order)
ON CONFLICT DO NOTHING;

-- Rent & Housing sub-categories
INSERT INTO categories (name, icon, parent_id, sort_order)
SELECT name, icon, (SELECT id FROM categories WHERE name = 'Rent & Housing' AND parent_id IS NULL), sort_order
FROM (VALUES
    ('Rent', '🔑', 1), ('Maintenance', '🔧', 2), ('Repairs', '🛠️', 3), ('Furniture', '🪑', 4)
) AS t(name, icon, sort_order)
ON CONFLICT DO NOTHING;

-- Credit Card sub-categories
INSERT INTO categories (name, icon, parent_id, sort_order)
SELECT name, icon, (SELECT id FROM categories WHERE name = 'Credit Card' AND parent_id IS NULL), sort_order
FROM (VALUES
    ('Repayment', '💸', 1)
) AS t(name, icon, sort_order)
ON CONFLICT DO NOTHING;

-- Income sub-categories
INSERT INTO categories (name, icon, parent_id, sort_order)
SELECT name, icon, (SELECT id FROM categories WHERE name = 'Income' AND parent_id IS NULL), sort_order
FROM (VALUES
    ('Salary', '💵', 1), ('Family', '👨‍👩‍👦', 2), ('Freelance', '💻', 3),
    ('Refund', '🔄', 4), ('Interest', '🏦', 5), ('Other', '📥', 6)
) AS t(name, icon, sort_order)
ON CONFLICT DO NOTHING;

-- ============================================
-- DEFAULT ACCOUNTS (ICICI + Utkarsh)
-- ============================================
INSERT INTO accounts (name, type, last_four, bank_name, sms_sender_id) VALUES
    ('ICICI Savings', 'bank', '0158', 'ICICI Bank', 'AX-ICICIT-S'),
    ('Utkarsh SuperCard', 'credit_card', '9413', 'Utkarsh SFBL', 'JK-UTKSPR-S')
ON CONFLICT DO NOTHING;
