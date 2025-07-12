import * as fs from 'fs';
import * as path from 'path';
import { Analysis } from '../../types';

export class Memory {
  private static memory: string[] = [];
  private static maxSize: number = 10;
  private static logFilePath: string = path.join('logs', 'analysis_log.txt');

  static add(entry: string): void {
    if (this.memory.length >= this.maxSize) {
      this.memory.shift(); // Remove the oldest entry
    }
    this.memory.push(entry);
  }

  static getAll(): string[] {
    return this.memory;
  }

  static clear(): void {
    this.memory = [];
  }

  static addAnalysis(analysis: Analysis): void {
    const timestamp = new Date().toISOString();
    const logEntry = `\n-----\nTimestamp: ${timestamp}\nBugs: ${JSON.stringify(analysis.bugs, null, 2)}\nUI Issues: ${JSON.stringify(analysis.ui_issues, null, 2)}\nNotes: ${analysis.notes}\n-----\n`;
    
    try {
      // Ensure logs directory exists
      const logDir = path.dirname(this.logFilePath);
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }
      
      fs.appendFileSync(this.logFilePath, logEntry);
    } catch (error) {
      console.error('Failed to write to log file:', error);
    }
  }

  static setLogFilePath(filePath: string): void {
    this.logFilePath = filePath;
  }
}