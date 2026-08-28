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
`);

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
  const insert = db.prepare('INSERT INTO services (name, duration_min, price) VALUES (?, ?, ?)');
  insert.run('Strzyżenie damskie krótkie', 60, '90 zł');
  insert.run('Strzyżenie damskie długie', 60, '130 zł');
  insert.run('Strzyżenie męskie', 30, '50 zł');
  insert.run('Modelowanie włosów', 30, '80 zł');
  insert.run('Koloryzacja (farbowanie odrostów)', 110, '190 zł');
  insert.run('Przedłużanie włosów', 240, '1200 zł');
  insert.run('Balejaż', 240, 'cena do ustalenia');
  insert.run('Farbowanie (wyjście z ciemności)', 480, '1200 zł');
  insert.run('Przekłucie uszu', 10, '100 zł');
  insert.run('Kręcenia włosów', 90, '220 zł');
  insert.run('Sombre', 210, '550 zł');
  insert.run('Odbudowa włosów', 90, '200 zł');
  insert.run('Farbowanie włosów na całej długości', 120, 'cena do ustalenia');
  insert.run('Odbudowa suchych, zniszczonych włosów', 80, '250 zł');
  insert.run('Refleksy koloryzacja', 180, '280 zł');
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

  // Все подтверждённые записи на ближайшие пару дней — для проверки напоминаний
  // Записи ровно месяц назад (30 дней), для которых ещё не слали "возвращайся"
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
