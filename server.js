require('dotenv').config();
const express = require('express');
const { handleMessage } = require('./botLogic');
const { sendMessage, isConfigured } = require('./greenApi');
require('./reminders'); // запускает фоновую задачу с напоминаниями

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Green API шлёт вебхук на этот адрес при входящем сообщении
app.post('/webhook', async (req, res) => {
  // Сразу подтверждаем получение вебхука
  res.status(200).end();

  const body = req.body || {};

  if (body.typeWebhook !== 'incomingMessageReceived') {
    // Другие типы вебхуков (статус доставки и т.п.) — игнорируем
    return;
  }

  const chatId = body.senderData && body.senderData.chatId;
  if (!chatId) return;

  const messageData = body.messageData || {};
  let text = '';
  if (messageData.textMessageData) {
    text = messageData.textMessageData.textMessage || '';
  } else if (messageData.extendedTextMessageData) {
    text = messageData.extendedTextMessageData.text || '';
  }

  console.log(`[IN] ${chatId}: ${text}`);

  let reply;
  try {
    reply = handleMessage(chatId, text);
  } catch (err) {
    console.error('Ошибка обработки сообщения:', err);
    reply = 'Упс, что-то пошло не так 😔 Напишите "меню", чтобы начать заново.';
  }

  await sendMessage(chatId, reply);
  console.log(`[OUT] ${chatId}: ${reply.slice(0, 60)}...`);
});

app.get('/', (req, res) => {
  res.send('WhatsApp booking bot (Green API) is running ✅ Green API настроен: ' + isConfigured());
});

app.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
  console.log(`Webhook URL для Green API: https://<ваш-домен>/webhook`);
});
