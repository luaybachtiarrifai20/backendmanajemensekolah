-- Table untuk menyimpan FCM tokens user
CREATE TABLE fcm_tokens (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  token TEXT NOT NULL,
  device_type ENUM('android', 'ios', 'web') NOT NULL,
  device_info VARCHAR(255),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  last_used_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_user_id (user_id),
  INDEX idx_token (token(255)),
  INDEX idx_is_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table untuk log notifikasi yang dikirim
CREATE TABLE notification_logs (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36),
  title VARCHAR(255) NOT NULL,
  body TEXT NOT NULL,
  type ENUM('tagihan', 'pembayaran', 'verifikasi', 'general') NOT NULL,
  reference_id VARCHAR(36), -- ID dari tagihan/pembayaran terkait
  fcm_response TEXT,
  is_sent BOOLEAN DEFAULT FALSE,
  sent_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_user_id (user_id),
  INDEX idx_type (type),
  INDEX idx_reference_id (reference_id),
  INDEX idx_is_sent (is_sent),
  INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
