import { ChildProcess, spawn } from 'child_process';
import express from 'express';
import log from 'electron-log';
import path from 'node:path';
import { Server } from 'http';

const logger = log.scope('PreviewManager');

export class PreviewManager {
  private serverProcess: Server | null = null;
  private tunnelProcess: ChildProcess | null = null;

  public start(projectPath: string): Promise<string> {
    return new Promise(async (resolve, reject) => {
      try {
        if (this.serverProcess || this.tunnelProcess) {
          await this.stop();
        }

        const port = await this.startLocalServer(projectPath);
        const url = await this.startCloudflareTunnel(port);
        resolve(url);
      } catch (error) {
        logger.error('Failed to start preview:', error);
        reject(error);
      }
    });
  }

  public async stop(): Promise<void> {
    logger.info('Stopping preview server and tunnel...');
    if (this.tunnelProcess) {
      this.tunnelProcess.kill('SIGTERM');
      this.tunnelProcess = null;
    }
    if (this.serverProcess) {
      await new Promise<void>((resolve) => {
        this.serverProcess?.close(() => {
          this.serverProcess = null;
          resolve()
        });
      });
    }
    logger.info('Preview stopped.');
  }

  private startLocalServer(projectPath: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const app = express();
      // projectPath is the root of the app, but we need to serve from the 'dist' or 'build' folder.
      // Assuming a standard vite/next build output folder. This may need adjustment.
      const staticPath = path.join(projectPath, 'dist'); 
      app.use(express.static(staticPath));

      const server = app.listen(0, () => { // Listen on a random free port
        const port = (server.address() as any).port;
        logger.info(`Local server started for "${staticPath}" on port ${port}`);
        this.serverProcess = server;
        resolve(port);
      });

      server.on('error', (err) => {
        reject(err);
      });
    });
  }

  private startCloudflareTunnel(port: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const cloudflared = spawn('npx', ['cloudflared', 'tunnel', '--url', `http://localhost:${port}`], { shell: true });
      this.tunnelProcess = cloudflared;

      let resolved = false;

      cloudflared.stdout.on('data', (data) => {
        const output = data.toString();
        logger.info(`cloudflared stdout: ${output}`);
        
        // Look for the tunnel URL
        const urlMatch = output.match(/(https?:\/\/[a-z0-9-]+\.trycloudflare\.com)/);
        if (urlMatch && urlMatch[1] && !resolved) {
          resolved = true;
          logger.info(`Cloudflare tunnel is live at: ${urlMatch[1]}`);
          resolve(urlMatch[1]);
        }
      });

      cloudflared.stderr.on('data', (data) => {
        const output = data.toString();
        logger.warn(`cloudflared stderr: ${output}`);
        
        // The URL can sometimes be printed to stderr, so we check here too.
        const urlMatch = output.match(/(https?:\/\/[a-z0-9-]+\.trycloudflare\.com)/);
        if (urlMatch && urlMatch[1] && !resolved) {
          resolved = true;
          logger.info(`Cloudflare tunnel is live at: ${urlMatch[1]}`);
          resolve(urlMatch[1]);
        }
      });
      
      cloudflared.on('close', (code) => {
        logger.warn(`cloudflared process exited with code ${code}`);
        if(!resolved) {
            reject(new Error(`cloudflared exited with code ${code} before creating a tunnel.`));
        }
      });
    });
  }
} 