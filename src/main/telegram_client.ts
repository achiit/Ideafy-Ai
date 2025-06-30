import WebSocket from 'ws';
import log from 'electron-log';
import { BrowserWindow } from 'electron';
import path from 'node:path';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { CreateAppParams } from '../ipc/ipc_types';
import { createApp } from '../ipc/handlers/app_handlers';

// WARNING: Storing secret tokens directly in the code is a major security risk.
const GEMINI_API_KEY = "AIzaSyBqjsYJdhiI0R4ITFEnA1MsWfeNl69MDUs";
const WEBSOCKET_URL = 'ws://localhost:3000';

class TelegramClient {
  private ws: WebSocket | null = null;
  private genAI: GoogleGenerativeAI;
  private model: any;

  constructor() {
    if (!GEMINI_API_KEY) {
      log.error("Gemini API key is not set.");
      // @ts-ignore
      this.genAI = null;
      // @ts-ignore
      this.model = null;
    } else {
      this.genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
      this.model = this.genAI.getGenerativeModel({ model: "gemini-2.5-flash" }); 
    }
    this.connect();
  }

  private connect() {
    this.ws = new WebSocket(WEBSOCKET_URL);
    this.ws.on('open', () => log.info('Connected to Telegram Bot Server.'));
    this.ws.on('message', (data: WebSocket.Data) => this.handleIncomingMessage(data));
    this.ws.on('close', () => {
      log.info('Disconnected from Telegram Bot Server. Reconnecting...');
      this.ws = null;
      setTimeout(() => this.connect(), 5000);
    });
    this.ws.on('error', (error) => log.error('WebSocket error:', error.message));
  }
  
  private async handleIncomingMessage(data: WebSocket.Data) {
    try {
      const message = JSON.parse(data.toString());
      log.info('Received message from bot server:', message);

      if (message.type === 'message' && message.text) {
        const intent = await this.getIntent(message.text);
        if (intent === 'BUILD') {
          await this.handleBuildRequest(message.chatId, message.text);
        } else { // CHAT
          await this.handleChatRequest(message.chatId, message.text);
        }
      }
    } catch (error) {
      log.error('Error processing message from bot server:', error);
    }
  }

  private sendToBot(message: object) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  private async getIntent(text: string): Promise<'BUILD' | 'CHAT'> {
    if (!this.model) return 'CHAT';
    const prompt = `Is the user asking to build, create, or generate a website? Answer only BUILD or CHAT.\nUser: "${text}"`;
    try {
      const result = await this.model.generateContent(prompt);
      const intentText = result.response.text().trim().toUpperCase();
      log.info(`Intent for "${text}" -> ${intentText}`);
      return intentText.includes('BUILD') ? 'BUILD' : 'CHAT';
    } catch (error) {
      log.error('Error getting intent:', error);
      return 'CHAT';
    }
  }
  
  private async handleChatRequest(chatId: number, prompt: string) {
    if (!this.model) return this.sendToBot({ type: 'response', chatId, text: "AI not configured." });
    try {
      const result = await this.model.startChat().sendMessage(prompt);
      this.sendToBot({ type: 'response', chatId, text: result.response.text() });
    } catch (error) {
      log.error('Gemini chat error:', error);
      this.sendToBot({ type: 'response', chatId, text: "Error chatting with AI." });
    }
  }

  private async handleBuildRequest(telegramChatId: number, prompt: string) {
    this.sendToBot({ type: 'build_start', chatId: telegramChatId });
    let buildWindow: BrowserWindow | null = null;

    try {
      const { app, chatId: dyadChatId } = await createApp({ name: `telegram-app-${Date.now()}` });
      this.sendToBot({ type: 'build_progress', chatId: telegramChatId, file: `Created project: ${app.name}` });

      buildWindow = new BrowserWindow({
        show: false, // Keep it hidden
        webPreferences: {
          // The preload script's path is relative to the build output's root
          preload: path.join(__dirname, 'telegram_build_preload.js'),
        },
      });

      // The HTML file is also relative to the build output's root
      await buildWindow.loadFile(path.join(__dirname, 'telegram_build_host.html'));
      
      this.sendToBot({ type: 'build_progress', chatId: telegramChatId, file: 'Invoking Dyad core AI...' });

      const finalResult = await buildWindow.webContents.executeJavaScript(
        `window.electronAPI.startBuild({ chatId: ${dyadChatId}, prompt: \`${prompt}\`, selectedComponent: null })`,
        true
      );
      
      // The `chat:stream` handler in dyad doesn't actually return the final content,
      // it sends it via chunks. The real app gets this from a stream.
      // For now, let's just signal completion. A more advanced version would stream the results.
      this.sendToBot({ type: 'response', chatId: telegramChatId, text: "Build process finished. The AI response would appear here." });

    } catch (error: any) {
      log.error("Error during build request:", error);
      this.sendToBot({ type: 'error', chatId: telegramChatId, message: `Build failed: ${error.message}` });
    } finally {
      if (buildWindow && !buildWindow.isDestroyed()) {
        buildWindow.close();
      }
    }
  }
}

export const initializeTelegramClient = () => {
  log.info('Initializing Telegram Client...');
  new TelegramClient();
};
