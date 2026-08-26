require('dotenv').config();
const express = require('express');
const twilio = require('twilio');
const { handleMessage } = require('./botLogic');
require('./reminders'); // запускает фоновую задачу с напоминаниями

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Твой номер Twilio (sandbox: whatsapp:+14155238886)
const client = process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
  ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
  : null;

app.post('/whatsapp', (req, res) => {
  const from = req.body.From;   // например "whatsapp:+48123456789"
  const body = req.body.Body || '';

  console.log(`[IN] ${from}: ${body}`);

  let reply;
  try {
    reply = handleMessage(from, body);
  } catch (err) {
    console.error('Ошибка обработки сообщения:', err);
    reply = 'Упс, что-то пошло не так 😔 Напишите "меню", чтобы начать заново.';
  }

  const twiml = new twilio.twiml.MessagingResponse();
  twiml.message(reply);

  res.type('text/xml').send(twiml.toString());
});

app.get('/', (req, res) => {
  res.send('WhatsApp booking bot is running ✅');
});

app.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
  console.log(`Webhook URL для Twilio: https://<ваш-домен>/whatsapp`);
});

module.exports = { client };
