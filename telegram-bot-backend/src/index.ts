import { Telegraf, Markup } from 'telegraf';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';

// This will store the active WebSocket connection to the Dyad app
let dyadSocket: WebSocket | null = null;

// This will store the Telegram chat ID to know where to send messages
const userSessions = new Map<number, { chatId: number; progressMessageId?: number, progressText?: string }>();

// This will store the message ID and text for each chat
const userMessages = new Map<number, { messageId: number; text: string }>();

// --- Telegram Bot Setup ---
const BOT_TOKEN = "8018775637:AAFvxCpKjYz7mMUIfHyBeWCJIjozCxPZglQ";
if (!BOT_TOKEN) {
  throw new Error("Bot token is missing!");
}
const bot = new Telegraf(BOT_TOKEN);

bot.start((ctx) => {
  const chatId = ctx.chat.id;
  userSessions.set(chatId, { chatId });
  console.log(`Bot started for chat ID: ${chatId}`);
  const welcomeMessage = dyadSocket 
    ? "Welcome! I'm connected to your Dyad app. Send me a prompt to build a website."
    : "Welcome! Please start your Dyad app and connect it to me to begin.";
  ctx.reply(welcomeMessage);
});

bot.help((ctx) => ctx.reply('Send any message to start building a website via your local Dyad app.'));

bot.on('text', async (ctx) => {
  const chatId = ctx.chat.id;
  // Ensure a session exists for the user. This is the critical fix.
  if (!userSessions.has(chatId)) {
    userSessions.set(chatId, { chatId });
    console.log(`New session created for chat ID: ${chatId} from a text message.`);
  }

  if (!dyadSocket) {
    await ctx.reply('Your Dyad app is not connected. Please start and connect it to continue.');
    return;
  }
  
  const messageToDyad = {
    type: 'message',
    chatId: chatId,
    text: ctx.message.text,
  };
  dyadSocket.send(JSON.stringify(messageToDyad));
});


// --- WebSocket Server Setup ---
const server = createServer();
const wss = new WebSocketServer({ server });

wss.on('connection', (ws: WebSocket) => {
  console.log('Dyad app connected.');
  dyadSocket = ws;

  for (const [chatId, session] of userSessions) {
    if (session) {
      bot.telegram.sendMessage(chatId, '✅ Your Dyad app has connected successfully!');
    }
  }

  ws.on('message', async (message: string) => {
    try {
      const data = JSON.parse(message);
      console.log('Received from Dyad:', data);

      const { chatId } = data;
      const userMessageInfo = userMessages.get(chatId);

      if (data.type === 'build_start') {
        const sentMessage = await bot.telegram.sendMessage(chatId, '🚀 Starting build...');
        userMessages.set(chatId, { messageId: sentMessage.message_id, text: sentMessage.text });
      } else if (data.type === 'build_progress' && userMessageInfo) {
        const newText = `${userMessageInfo.text}\n✅ ${data.file}`;
        await bot.telegram.editMessageText(chatId, userMessageInfo.messageId, undefined, newText);
        userMessages.set(chatId, { ...userMessageInfo, text: newText });
      } else if (data.type === 'response' && userMessageInfo) {
        const newText = `${userMessageInfo.text}\n\n✨ Preview is ready!\nClick the button below to see your live website preview.`;
        const url = data.text; // Assuming the response for a build is the URL
        await bot.telegram.editMessageText(chatId, userMessageInfo.messageId, undefined, newText, {
          ...Markup.inlineKeyboard([
            Markup.button.webApp('🚀 Open Preview', url)
          ])
        });
        userMessages.delete(chatId);
      } else if (data.type === 'response') { // Simple text response
        await bot.telegram.sendMessage(chatId, data.text);
      } else if (data.type === 'error' && userMessageInfo) {
        const newText = `${userMessageInfo.text}\n\n❌ Build failed: ${data.message}`;
        await bot.telegram.editMessageText(chatId, userMessageInfo.messageId, undefined, newText);
        userMessages.delete(chatId);
      } else if (data.type === 'error') {
        await bot.telegram.sendMessage(chatId, `❌ Build failed: ${data.message}`);
      }

    } catch (error) {
      console.error('Error processing message from Dyad:', error);
    }
  });

  ws.on('close', () => {
    console.log('Dyad app disconnected.');
    dyadSocket = null;
    for (const [chatId, session] of userSessions) {
        if(session) bot.telegram.sendMessage(chatId, '⚠️ Your Dyad app has disconnected.');
    }
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
    dyadSocket = null;
  });
});


// --- Start Servers ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`WebSocket server started on port ${PORT}`);
  bot.launch();
  console.log('Telegram bot is running...');
});

// Enable graceful stop
process.once('SIGINT', () => {
  wss.close();
  server.close();
  bot.stop('SIGINT')
});
process.once('SIGTERM', () => {
  wss.close();
  server.close();
  bot.stop('SIGTERM')
}); 