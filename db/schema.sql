-- 城市智慧停车运营管理平台 表结构（全程 utf8mb4，确保中文正常）
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS users (
  id            INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  username      VARCHAR(64) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  name          VARCHAR(64) NOT NULL,
  role          VARCHAR(16) NOT NULL DEFAULT 'VIEWER',
  status        VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS parking_lots (
  id            INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  code          VARCHAR(32) NOT NULL UNIQUE,
  name          VARCHAR(128) NOT NULL,
  district      VARCHAR(64) NOT NULL,
  address       VARCHAR(255) NOT NULL DEFAULT '',
  total_spaces  INT NOT NULL DEFAULT 0,
  status        VARCHAR(16) NOT NULL DEFAULT 'OPEN',
  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS parking_spaces (
  id          INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  lot_id      INT UNSIGNED NOT NULL,
  code        VARCHAR(32) NOT NULL,
  type        VARCHAR(16) NOT NULL DEFAULT 'STANDARD',
  status      VARCHAR(16) NOT NULL DEFAULT 'FREE',
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uk_lot_space (lot_id, code),
  CONSTRAINT fk_space_lot FOREIGN KEY (lot_id) REFERENCES parking_lots(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS vehicles (
  id           INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  plate_no     VARCHAR(16) NOT NULL UNIQUE,
  owner_name   VARCHAR(64) NOT NULL DEFAULT '',
  phone        VARCHAR(32) NOT NULL DEFAULT '',
  vehicle_type VARCHAR(16) NOT NULL DEFAULT 'SMALL',
  is_member    TINYINT(1) NOT NULL DEFAULT 0,
  created_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS parking_sessions (
  id          INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  lot_id      INT UNSIGNED NOT NULL,
  space_id    INT UNSIGNED NULL,
  plate_no    VARCHAR(16) NOT NULL,
  enter_time  DATETIME(3) NOT NULL,
  exit_time   DATETIME(3) NULL,
  fee_cents   INT NOT NULL DEFAULT 0,
  status      VARCHAR(16) NOT NULL DEFAULT 'PARKED',
  paid        TINYINT(1) NOT NULL DEFAULT 0,
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  enter_rule_id INT UNSIGNED NULL,
  transition_notified TINYINT(1) NOT NULL DEFAULT 0,
  CONSTRAINT fk_session_lot FOREIGN KEY (lot_id) REFERENCES parking_lots(id) ON DELETE CASCADE,
  CONSTRAINT fk_session_space FOREIGN KEY (space_id) REFERENCES parking_spaces(id) ON DELETE SET NULL,
  INDEX idx_session_status (status),
  INDEX idx_session_plate (plate_no),
  INDEX idx_session_space (space_id),
  INDEX idx_session_enter_time (enter_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

/* ==================== 签约单位 ==================== */
CREATE TABLE IF NOT EXISTS contract_organizations (
  id          INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  name        VARCHAR(128) NOT NULL,
  contact     VARCHAR(64) NOT NULL DEFAULT '',
  phone       VARCHAR(32) NOT NULL DEFAULT '',
  share_ratio DECIMAL(5,2) NOT NULL DEFAULT 70.00,
  status      VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_org_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

/* ==================== 签约车辆白名单 ==================== */
CREATE TABLE IF NOT EXISTS org_vehicle_whitelist (
  id         INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  org_id     INT UNSIGNED NOT NULL,
  plate_no   VARCHAR(16) NOT NULL,
  start_date DATE NOT NULL,
  end_date   DATE NULL,
  status     VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uk_org_plate (org_id, plate_no),
  CONSTRAINT fk_whitelist_org FOREIGN KEY (org_id) REFERENCES contract_organizations(id) ON DELETE CASCADE,
  INDEX idx_whitelist_plate (plate_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

/* ==================== 费率方案 ==================== */
CREATE TABLE IF NOT EXISTS rate_plans (
  id                   INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  name                 VARCHAR(64) NOT NULL,
  rate_type            VARCHAR(16) NOT NULL DEFAULT 'HOURLY',
  base_rate_cents      INT NOT NULL DEFAULT 0,
  free_minutes         INT NOT NULL DEFAULT 15,
  max_daily_cents      INT NULL,
  grace_period_minutes INT NOT NULL DEFAULT 30,
  overtime_multiplier  DECIMAL(4,2) NOT NULL DEFAULT 1.50,
  is_exclusive         TINYINT(1) NOT NULL DEFAULT 0,
  status               VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
  created_at           DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at           DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

/* ==================== 节假日配置 ==================== */
CREATE TABLE IF NOT EXISTS holidays (
  id         INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  date       DATE NOT NULL UNIQUE,
  name       VARCHAR(64) NOT NULL,
  type       VARCHAR(16) NOT NULL DEFAULT 'PUBLIC',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_holiday_date (date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

/* ==================== 时段归属规则 ==================== */
CREATE TABLE IF NOT EXISTS time_ownership_rules (
  id                   INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  name                 VARCHAR(128) NOT NULL,
  lot_id               INT UNSIGNED NOT NULL,
  org_id               INT UNSIGNED NULL,
  ownership_type       VARCHAR(16) NOT NULL,
  rate_plan_id         INT UNSIGNED NOT NULL,
  applicable_days      VARCHAR(32) NOT NULL DEFAULT '1,2,3,4,5',
  include_holidays     TINYINT(1) NOT NULL DEFAULT 0,
  time_start           TIME NOT NULL,
  time_end             TIME NOT NULL,
  priority             INT NOT NULL DEFAULT 10,
  status               VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
  effective_date       DATE NULL,
  expiry_date          DATE NULL,
  created_at           DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at           DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_rule_lot FOREIGN KEY (lot_id) REFERENCES parking_lots(id) ON DELETE CASCADE,
  CONSTRAINT fk_rule_org FOREIGN KEY (org_id) REFERENCES contract_organizations(id) ON DELETE SET NULL,
  CONSTRAINT fk_rule_rate FOREIGN KEY (rate_plan_id) REFERENCES rate_plans(id),
  INDEX idx_rule_lot (lot_id),
  INDEX idx_rule_org (org_id),
  INDEX idx_rule_status (status),
  INDEX idx_rule_priority (priority)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

/* ==================== 车位-规则绑定 ==================== */
CREATE TABLE IF NOT EXISTS space_rule_bindings (
  id         INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  space_id   INT UNSIGNED NOT NULL,
  rule_id    INT UNSIGNED NOT NULL,
  effective_date DATE NULL,
  expiry_date    DATE NULL,
  status     VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uk_space_rule (space_id, rule_id),
  CONSTRAINT fk_binding_space FOREIGN KEY (space_id) REFERENCES parking_spaces(id) ON DELETE CASCADE,
  CONSTRAINT fk_binding_rule FOREIGN KEY (rule_id) REFERENCES time_ownership_rules(id) ON DELETE CASCADE,
  INDEX idx_binding_space (space_id),
  INDEX idx_binding_rule (rule_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

/* ==================== 时段切换事件 ==================== */
CREATE TABLE IF NOT EXISTS transition_events (
  id              INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  space_id        INT UNSIGNED NOT NULL,
  session_id      INT UNSIGNED NOT NULL,
  from_rule_id    INT UNSIGNED NULL,
  to_rule_id      INT UNSIGNED NOT NULL,
  transition_time DATETIME(3) NOT NULL,
  action_taken    VARCHAR(32) NOT NULL,
  grace_expiry    DATETIME(3) NULL,
  notified        TINYINT(1) NOT NULL DEFAULT 0,
  note            VARCHAR(255) NULL,
  created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_transition_space FOREIGN KEY (space_id) REFERENCES parking_spaces(id) ON DELETE CASCADE,
  CONSTRAINT fk_transition_session FOREIGN KEY (session_id) REFERENCES parking_sessions(id) ON DELETE CASCADE,
  INDEX idx_transition_time (transition_time),
  INDEX idx_transition_space (space_id),
  INDEX idx_transition_session (session_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

/* ==================== 停车分段计费明细 ==================== */
CREATE TABLE IF NOT EXISTS billing_segments (
  id           INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  session_id   INT UNSIGNED NOT NULL,
  rule_id      INT UNSIGNED NULL,
  segment_start DATETIME(3) NOT NULL,
  segment_end  DATETIME(3) NOT NULL,
  duration_min INT NOT NULL,
  rate_cents   INT NOT NULL,
  amount_cents INT NOT NULL,
  is_overtime  TINYINT(1) NOT NULL DEFAULT 0,
  created_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_segment_session FOREIGN KEY (session_id) REFERENCES parking_sessions(id) ON DELETE CASCADE,
  CONSTRAINT fk_segment_rule FOREIGN KEY (rule_id) REFERENCES time_ownership_rules(id) ON DELETE SET NULL,
  INDEX idx_segment_session (session_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

/* ==================== 共享收益流水 ==================== */
CREATE TABLE IF NOT EXISTS shared_transactions (
  id                INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  session_id        INT UNSIGNED NOT NULL,
  space_id          INT UNSIGNED NULL,
  rule_id           INT UNSIGNED NULL,
  org_id            INT UNSIGNED NULL,
  transaction_type  VARCHAR(16) NOT NULL,
  total_amount_cents INT NOT NULL DEFAULT 0,
  org_share_cents   INT NOT NULL DEFAULT 0,
  operator_share_cents INT NOT NULL DEFAULT 0,
  share_ratio       DECIMAL(5,2) NOT NULL,
  settlement_date   DATE NULL,
  settled           TINYINT(1) NOT NULL DEFAULT 0,
  created_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_transaction_session FOREIGN KEY (session_id) REFERENCES parking_sessions(id) ON DELETE CASCADE,
  CONSTRAINT fk_transaction_space FOREIGN KEY (space_id) REFERENCES parking_spaces(id) ON DELETE SET NULL,
  CONSTRAINT fk_transaction_rule FOREIGN KEY (rule_id) REFERENCES time_ownership_rules(id) ON DELETE SET NULL,
  CONSTRAINT fk_transaction_org FOREIGN KEY (org_id) REFERENCES contract_organizations(id) ON DELETE SET NULL,
  INDEX idx_transaction_org (org_id),
  INDEX idx_transaction_settled (settled),
  INDEX idx_transaction_date (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

/* ==================== 车位利用率统计 ==================== */
CREATE TABLE IF NOT EXISTS utilization_stats (
  id                INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  space_id          INT UNSIGNED NOT NULL,
  stat_date         DATE NOT NULL,
  ownership_type    VARCHAR(16) NOT NULL,
  total_minutes     INT NOT NULL DEFAULT 0,
  occupied_minutes  INT NOT NULL DEFAULT 0,
  utilization_rate  DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  session_count     INT NOT NULL DEFAULT 0,
  created_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uk_space_date_type (space_id, stat_date, ownership_type),
  CONSTRAINT fk_utilization_space FOREIGN KEY (space_id) REFERENCES parking_spaces(id) ON DELETE CASCADE,
  INDEX idx_utilization_date (stat_date),
  INDEX idx_utilization_space (space_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

/* ==================== 实时车位状态快照 ==================== */
CREATE TABLE IF NOT EXISTS space_ownership_snapshots (
  id               INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  space_id         INT UNSIGNED NOT NULL UNIQUE,
  current_rule_id  INT UNSIGNED NULL,
  ownership_type   VARCHAR(16) NULL,
  org_id           INT UNSIGNED NULL,
  available        TINYINT(1) NOT NULL DEFAULT 1,
  next_transition  DATETIME(3) NULL,
  next_rule_id     INT UNSIGNED NULL,
  snapshot_time    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_snapshot_space FOREIGN KEY (space_id) REFERENCES parking_spaces(id) ON DELETE CASCADE,
  CONSTRAINT fk_snapshot_rule FOREIGN KEY (current_rule_id) REFERENCES time_ownership_rules(id) ON DELETE SET NULL,
  INDEX idx_snapshot_available (available),
  INDEX idx_snapshot_ownership (ownership_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
