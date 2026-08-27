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
  reminder_sent INTEGER DEFAULT 0,
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
`);

// --- Услуги по умолчанию (мастер сможет поменять) ---
const seedServices = db.prepare('SELECT COUNT(*) as c FROM services').get();
if (seedServices.c === 0) {
  const insert = db.prepare('INSERT INTO services (name, duration_min, price) VALUES (?, ?, ?)');
  insert.run('Стрижка мужская', 30, '50 zł');
  insert.run('Стрижка + борода', 45, '70 zł');
  insert.run('Окрашивание', 90, '150 zł');
}

// --- Рабочие часы (мастер может поменять в config.js) ---
module.exports = {
  db,

  getServices() {
    return db.prepare('SELECT * FROM services').all();
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

  createBooking({ phone, client_name, service_id, date, time }) {
    const info = db.prepare(`
      INSERT INTO bookings (phone, client_name, service_id, date, time)
      VALUES (?, ?, ?, ?, ?)
    `).run(phone, client_name, service_id, date, time);
    return info.lastInsertRowid;
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

  updateBookingDateTime(id, date, time) {
    db.prepare('UPDATE bookings SET date = ?, time = ? WHERE id = ?').run(date, time, id);
  },

  cancelBooking(id) {
    db.prepare("UPDATE bookings SET status = 'cancelled' WHERE id = ?").run(id);
  },

  getBookingsNeedingReminder(dateStr) {
    return db.prepare(`
      SELECT * FROM bookings
      WHERE date = ? AND status = 'confirmed' AND reminder_sent = 0
    `).all(dateStr);
  },

  markReminderSent(id) {
    db.prepare('UPDATE bookings SET reminder_sent = 1 WHERE id = ?').run(id);
  }
};
