-- ==========================================
-- FCM SYSTEM DIAGNOSTIC SQL
-- Quick check untuk FCM notification system
-- ==========================================

-- 1. Check tables exist
SELECT 'Checking tables...' as step;
SELECT 
  TABLE_NAME,
  'EXISTS' as status
FROM information_schema.TABLES 
WHERE TABLE_SCHEMA = 'manajemen_sekolah'
AND TABLE_NAME IN ('fcm_tokens', 'notification_logs');

-- 2. Count active FCM tokens
SELECT 'Active FCM Tokens' as step;
SELECT 
  device_type,
  COUNT(*) as count,
  MAX(created_at) as last_registered
FROM fcm_tokens
WHERE is_active = TRUE
GROUP BY device_type;

-- 3. Recent FCM token registrations
SELECT 'Recent Token Registrations' as step;
SELECT 
  u.nama,
  u.role,
  ft.device_type,
  ft.created_at,
  ft.last_used_at
FROM fcm_tokens ft
JOIN users u ON ft.user_id = u.id
WHERE ft.is_active = TRUE
ORDER BY ft.created_at DESC
LIMIT 10;

-- 4. Notification logs summary
SELECT 'Notification Summary' as step;
SELECT 
  type,
  COUNT(*) as total_sent,
  SUM(CASE WHEN is_sent = TRUE THEN 1 ELSE 0 END) as successful,
  SUM(CASE WHEN is_sent = FALSE THEN 1 ELSE 0 END) as failed,
  MAX(sent_at) as last_sent
FROM notification_logs
GROUP BY type;

-- 5. Recent notifications
SELECT 'Recent Notifications (Last 10)' as step;
SELECT 
  nl.id,
  u.nama as sent_to,
  nl.title,
  nl.type,
  nl.is_sent,
  nl.sent_at,
  nl.created_at
FROM notification_logs nl
LEFT JOIN users u ON nl.user_id = u.id
ORDER BY nl.created_at DESC
LIMIT 10;

-- 6. Failed notifications
SELECT 'Failed Notifications' as step;
SELECT 
  nl.id,
  u.nama as sent_to,
  nl.title,
  nl.created_at,
  LEFT(nl.fcm_response, 100) as error_preview
FROM notification_logs nl
LEFT JOIN users u ON nl.user_id = u.id
WHERE nl.is_sent = FALSE
ORDER BY nl.created_at DESC
LIMIT 5;

-- 7. Wali murid with FCM tokens
SELECT 'Wali Murid with Tokens' as step;
SELECT 
  u.id,
  u.nama,
  s.nama as nama_siswa,
  k.nama as kelas,
  ft.device_type,
  ft.created_at as token_registered
FROM users u
LEFT JOIN siswa s ON u.siswa_id = s.id
LEFT JOIN kelas k ON s.kelas_id = k.id
LEFT JOIN fcm_tokens ft ON u.id = ft.user_id AND ft.is_active = TRUE
WHERE u.role = 'wali'
ORDER BY ft.created_at DESC;

-- 8. Quick health check
SELECT '=== FCM SYSTEM HEALTH CHECK ===' as step;
SELECT 
  'Total Active Tokens' as metric,
  COUNT(*) as value,
  CASE 
    WHEN COUNT(*) = 0 THEN '❌ NO TOKENS REGISTERED'
    WHEN COUNT(*) < 5 THEN '⚠️ FEW TOKENS'
    ELSE '✅ HEALTHY'
  END as status
FROM fcm_tokens 
WHERE is_active = TRUE

UNION ALL

SELECT 
  'Notifications Sent (Today)' as metric,
  COUNT(*) as value,
  CASE 
    WHEN COUNT(*) = 0 THEN '⚠️ NO NOTIFICATIONS TODAY'
    ELSE '✅ ACTIVE'
  END as status
FROM notification_logs
WHERE DATE(created_at) = CURDATE()
AND is_sent = TRUE

UNION ALL

SELECT 
  'Failed Notifications (Today)' as metric,
  COUNT(*) as value,
  CASE 
    WHEN COUNT(*) > 0 THEN '⚠️ CHECK ERRORS'
    ELSE '✅ NO FAILURES'
  END as status
FROM notification_logs
WHERE DATE(created_at) = CURDATE()
AND is_sent = FALSE

UNION ALL

SELECT 
  'iOS Tokens' as metric,
  COUNT(*) as value,
  '📱' as status
FROM fcm_tokens
WHERE device_type = 'ios' AND is_active = TRUE

UNION ALL

SELECT 
  'Android Tokens' as metric,
  COUNT(*) as value,
  '🤖' as status
FROM fcm_tokens
WHERE device_type = 'android' AND is_active = TRUE;
