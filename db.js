const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'bookings.db'));
db.pragma('journal_mode = WAL');

// --- Схема ---
db.exec(`
CREATE TABLE IF NOT EXISTS services (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  duration_min INTEGER NOT NULL,
  price TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT NOT NULL,
  client_name TEXT,
  service_id INTEGER,
  date TEXT NOT NULL,      -- YYYY-MM-DD
  time TEXT NOT NULL,      -- HH:MM
  status TEXT DEFAULT 'confirmed', -- confirmed | cancelled
  reminder_sent INTEGER DEFAULT 0,     -- напоминание за 24ч
  reminder_2h_sent INTEGER DEFAULT 0,  -- напоминание за 2ч
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (service_id) REFERENCES services(id)
);

CREATE TABLE IF NOT EXISTS conversation_state (
  phone TEXT PRIMARY KEY,
  step TEXT,
  data TEXT   -- JSON строка с данными текущего диалога
);

CREATE TABLE IF NOT EXISTS user_lang (
  phone TEXT PRIMARY KEY,
  lang TEXT
);

CREATE TABLE IF NOT EXISTS pending_notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS blocked_slots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  reason TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
`);

// Защита от одновременной записи на один и тот же слот.
// Индекс частичный — блокирует только активные (confirmed) записи,
// отменённые слот не занимают и не мешают новой брони.
// Если в базе уже есть конфликтующие confirmed-записи на один date+time,
// создание индекса упадёт с ошибкой — тогда нужно сначала вручную
// разрешить конфликт (отменить/перенести одну из записей).
db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_slot
  ON bookings(date, time)
  WHERE status = 'confirmed';
`);

// Миграция: столбец active для услуг (чтобы можно было "удалять" услугу, не теряя историю записей)
try {
  db.exec('ALTER TABLE services ADD COLUMN active INTEGER DEFAULT 1');
} catch (e) {
  // столбец уже существует
}

// Миграция: если база уже существовала до добавления reminder_2h_sent — добавляем столбец
try {
  db.exec('ALTER TABLE bookings ADD COLUMN reminder_2h_sent INTEGER DEFAULT 0');
} catch (e) {
  // столбец уже существует — это нормально, ничего не делаем
}

// Миграция: столбец для отметки об отправке напоминания "вернись через месяц"
try {
  db.exec('ALTER TABLE bookings ADD COLUMN winback_sent INTEGER DEFAULT 0');
} catch (e) {
  // столбец уже существует — это нормально, ничего не делаем
}

// --- Услуги по умолчанию (мастер сможет поменять) ---
const seedServices = db.prepare('SELECT COUNT(*) as c FROM services').get();
if (seedServices.c === 0) {
  const insert = db.prepare('INSERT INTO services (name, duration_min, price, active) VALUES (?, ?, ?, 1)');
  // ЗАМЕНИ на реальные услуги, цены и длительность
  insert.run('Manicure klasyczny', 60, '60 zł');
  insert.run('Manicure hybrydowy', 75, '90 zł');
  insert.run('Pedicure klasyczny', 60, '80 zł');
  insert.run('Pedicure hybrydowy', 90, '110 zł');
  insert.run('Przedłużanie paznokci', 120, '150 zł');
}

// --- Рабочие часы (мастер может поменять в config.js) ---
module.exports = {
  db,

  getServices() {
    return db.prepare('SELECT * FROM services WHERE active = 1').all();
  },

  getAllServicesForAdmin() {
    return db.prepare('SELECT * FROM services ORDER BY active DESC, id').all();
  },

  addService(name, duration_min, price) {
    const info = db.prepare('INSERT INTO services (name, duration_min, price, active) VALUES (?, ?, ?, 1)').run(name, duration_min, price);
    return info.lastInsertRowid;
  },

  updateServicePrice(id, price) {
    db.prepare('UPDATE services SET price = ? WHERE id = ?').run(price, id);
  },

  updateServiceDuration(id, duration_min) {
    db.prepare('UPDATE services SET duration_min = ? WHERE id = ?').run(duration_min, id);
  },

  setServiceActive(id, active) {
    db.prepare('UPDATE services SET active = ? WHERE id = ?').run(active ? 1 : 0, id);
  },

  // ---------- Заблокированные промежутки времени ----------

  addBlockedSlot(date, startTime, endTime, reason) {
    const info = db.prepare(`
      INSERT INTO blocked_slots (date, start_time, end_time, reason) VALUES (?, ?, ?, ?)
    `).run(date, startTime, endTime, reason || null);
    return info.lastInsertRowid;
  },

  removeBlockedSlot(id) {
    db.prepare('DELETE FROM blocked_slots WHERE id = ?').run(id);
  },

  getBlockedSlotsForDate(date) {
    return db.prepare('SELECT * FROM blocked_slots WHERE date = ?').all(date);
  },

  getUpcomingBlockedSlots() {
    return db.prepare(`
      SELECT * FROM blocked_slots WHERE date >= date('now') ORDER BY date, start_time LIMIT 30
    `).all();
  },

  getServiceById(id) {
    return db.prepare('SELECT * FROM services WHERE id = ?').get(id);
  },

  getUserLang(phone) {
    const row = db.prepare('SELECT lang FROM user_lang WHERE phone = ?').get(phone);
    return row ? row.lang : null;
  },

  setUserLang(phone, lang) {
    db.prepare(`
      INSERT INTO user_lang (phone, lang) VALUES (?, ?)
      ON CONFLICT(phone) DO UPDATE SET lang = excluded.lang
    `).run(phone, lang);
  },

  getState(phone) {
    const row = db.prepare('SELECT * FROM conversation_state WHERE phone = ?').get(phone);
    if (!row) return { step: 'menu', data: {} };
    return { step: row.step, data: JSON.parse(row.data || '{}') };
  },

  setState(phone, step, data = {}) {
    db.prepare(`
      INSERT INTO conversation_state (phone, step, data) VALUES (?, ?, ?)
      ON CONFLICT(phone) DO UPDATE SET step = excluded.step, data = excluded.data
    `).run(phone, step, JSON.stringify(data));
  },

  resetState(phone) {
    db.prepare('DELETE FROM conversation_state WHERE phone = ?').run(phone);
  },

  getBookingsForDate(date) {
    return db.prepare("SELECT * FROM bookings WHERE date = ? AND status = 'confirmed'").all(date);
  },

  // Возвращает { success: true, id } при успехе или
  // { success: false, reason: 'slot_taken' }, если между проверкой
  // свободных слотов и этой вставкой кто-то другой уже занял тот же
  // date+time (гонка запросов). Уникальный индекс idx_unique_active_slot
  // гарантирует, что база физически не пропустит дубликат.
  createBooking({ phone, client_name, service_id, date, time }) {
    try {
      const info = db.prepare(`
        INSERT INTO bookings (phone, client_name, service_id, date, time)
        VALUES (?, ?, ?, ?, ?)
      `).run(phone, client_name, service_id, date, time);
      return { success: true, id: info.lastInsertRowid };
    } catch (e) {
      if (e.code && e.code.startsWith('SQLITE_CONSTRAINT')) {
        return { success: false, reason: 'slot_taken' };
      }
      throw e;
    }
  },

  getAllUpcomingBookings() {
    return db.prepare(`
      SELECT * FROM bookings
      WHERE status = 'confirmed' AND date >= date('now')
      ORDER BY date, time
      LIMIT 30
    `).all();
  },

  getUpcomingBookingsByPhone(phone) {
    return db.prepare(`
      SELECT * FROM bookings
      WHERE phone = ? AND status = 'confirmed' AND date >= date('now')
      ORDER BY date, time
    `).all(phone);
  },

  getBookingById(id) {
    return db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
  },

  // Возвращает { success: true } при успехе или
  // { success: false, reason: 'slot_taken' }, если новый date+time
  // уже занят другой активной записью (гонка запросов при переносе).
  updateBookingDateTime(id, date, time) {
    try {
      db.prepare(`
        UPDATE bookings
        SET date = ?, time = ?, reminder_sent = 0, reminder_2h_sent = 0
        WHERE id = ?
      `).run(date, time, id);
      return { success: true };
    } catch (e) {
      if (e.code && e.code.startsWith('SQLITE_CONSTRAINT')) {
        return { success: false, reason: 'slot_taken' };
      }
      throw e;
    }
  },

  cancelBooking(id) {
    db.prepare("UPDATE bookings SET status = 'cancelled' WHERE id = ?").run(id);
  },

  // Все подтверждённые записи на ближайшие пару дней — для проверки напоминаний
  // Записи ровно месяц назад (30 дней), для которых ещё не слали "возвращайся"
  addPendingNotification(message) {
    db.prepare('INSERT INTO pending_notifications (message) VALUES (?)').run(message);
  },

  getPendingNotifications() {
    return db.prepare('SELECT * FROM pending_notifications ORDER BY id').all();
  },

  clearPendingNotifications() {
    db.prepare('DELETE FROM pending_notifications').run();
  },

  getBookingsForWinback() {
    return db.prepare(`
      SELECT * FROM bookings
      WHERE status = 'confirmed'
        AND winback_sent = 0
        AND date = date('now', '-30 days')
    `).all();
  },

  markWinbackSent(id) {
    db.prepare('UPDATE bookings SET winback_sent = 1 WHERE id = ?').run(id);
  },

  getBookingsForReminderCheck() {
    return db.prepare(`
      SELECT * FROM bookings
      WHERE status = 'confirmed'
        AND date >= date('now')
        AND date <= date('now', '+2 days')
        AND (reminder_sent = 0 OR reminder_2h_sent = 0)
    `).all();
  },

  markReminder24hSent(id) {
    db.prepare('UPDATE bookings SET reminder_sent = 1 WHERE id = ?').run(id);
  },

  markReminder2hSent(id) {
    db.prepare('UPDATE bookings SET reminder_2h_sent = 1 WHERE id = ?').run(id);
  },
};
