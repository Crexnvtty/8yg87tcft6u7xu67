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

app.post('/whatsapp', async (req, res) => {
  const from = req.body.From;   // например "whatsapp:+48123456789"
  const to = req.body.To;       // номер бота (Twilio-номер)
  const body = req.body.Body || '';

  console.log(`[IN] ${from}: ${body}`);

  // Сразу отвечаем Twilio пустым 200 OK — подтверждаем получение вебхука.
  // Сам ответ пользователю шлём отдельным запросом через Messages API,
  // так как во время триала Twilio больше не поддерживает прямой TwiML-ответ.
  res.status(200).end();

  let reply;
  try {
    reply = handleMessage(from, body);
  } catch (err) {
    console.error('Ошибка обработки сообщения:', err);
    reply = 'Упс, что-то пошло не так 😔 Напишите "меню", чтобы начать заново.';
  }

  if (!client) {
    console.error('Twilio client не настроен — проверь TWILIO_ACCOUNT_SID и TWILIO_AUTH_TOKEN в переменных окружения.');
    return;
  }

  try {
    await client.messages.create({
      from: to,   // номер бота, на который писал пользователь
      to: from,   // пользователь, которому отвечаем
      body: reply
    });
    console.log(`[OUT] ${from}: ${reply.slice(0, 60)}...`);
  } catch (err) {
    console.error('Ошибка отправки ответа через Messages API:', err.message);
  }
});

app.get('/', (req, res) => {
  res.send('WhatsApp booking bot is running ✅');
});

app.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
  console.log(`Webhook URL для Twilio: https://<ваш-домен>/whatsapp`);
});

module.exports = { client };
