import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { State } from './types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type MissionStatus = 'pending' | 'done';

interface Entry {
  text: string;
  status: MissionStatus;
}

interface NavigationNode {
  page: string;
  children: Set<string>;
  visitCount: number;
}

export class LogManager {
  private static logs: string[] = [];
  private static logFilePath: string = path.join('logs', 'agent.log');
  private static filePath = path.join(__dirname, path.join('logs', 'mission_log.md'));
  private static navigationTree: Map<string, NavigationNode> = new Map();

  /**
   * Logs a message with a timestamp and agent state.
   * Stores it in memory, optionally prints to console, and appends it to a file.
   * @param message - The message to log.
   * @param state - The current state of the agent (default is ERROR).
   * @param logToConsole - Whether to print to console (default: true).
   */
  static log(message: string, state: State = State.ERROR, logToConsole: boolean = true): void {
    const timestamped = `[${new Date().toISOString()}] [state: ${state}] ${message}`;
    LogManager.logs.push(timestamped);

    if (logToConsole) console.log(timestamped);

    // Ensure log folder exists and write to file
    try {
      fs.mkdirSync(path.dirname(LogManager.logFilePath), { recursive: true });
      fs.appendFileSync(LogManager.logFilePath, timestamped + '\n');
    } catch (err) {
      console.error('Error writing to log file:', err);
    }
  }

  /**
   * Logs an error message with a standardized format.
   * Adds it to memory and prints to console.
   * @param message - The error message to log.
   * @param state - The state where the error occurred (default is ERROR).
   * @param logToConsole - Whether to print to console (default: true).
  */
  static error(message: string, state: State = State.ERROR, logToConsole: boolean = true): void {
    const errorMessage = `[ERROR] ${message} at [state: ${state}] `;
    LogManager.logs.push(errorMessage);
    console.error(errorMessage);
  }

  /**
   * Returns all logs currently stored in memory.
   * @returns An array of log strings.
  */
  static getLogs(): string[] {
    return LogManager.logs;
  }

  static clearLogs(): void {
    LogManager.logs = [];

    try {
      fs.writeFileSync(LogManager.logFilePath, '');
    } catch (err) {
      console.error('Error clearing log file:', err);
    }
  }

  private static sections = {
    mission: '## Mission',
    subMissions: '## SubMissions',
    navigationTree: '## Navigation Tree',
    extraInfo: '## Extra Info',
  };

  // Initialize the markdown file with empty sections
  static initialize() {
    const content = `${this.sections.mission}\n\n${this.sections.subMissions}\n\n${this.sections.extraInfo}\n`;
    fs.writeFileSync(this.filePath, content, 'utf-8');
  }

  /**
   * Adds a new mission entry under the Mission section in markdown.
   * @param text - The mission description.
   * @param status - The mission status ('pending' or 'done').
  */
  static addMission(text: string, status: MissionStatus = 'pending') {
    const data = fs.readFileSync(this.filePath, 'utf-8');
    const section = this.sections.mission;
    const newEntry = `- [${status === 'done' ? 'x' : ' '}] ${text}`;

    const updated = data.replace(
      new RegExp(`(${section})([\\s\\S]*?)(?=\\n##|$)`),
      `$1\n\n${newEntry}\n`
    );

    fs.writeFileSync(this.filePath, updated.trimEnd() + '\n', 'utf-8');
  }

  /**
   * Appends a bullet point entry under the Extra Info section in markdown.
   * @param info - The additional information to include.
  */
  static addExtraInfo(info: string) {
    const data = fs.readFileSync(this.filePath, 'utf-8');
    const updated = data.replace(
      new RegExp(`${this.sections.extraInfo}[\\s\\S]*$`),
      `${this.sections.extraInfo}\n- ${info}`
    );
    fs.writeFileSync(this.filePath, updated, 'utf-8');
  }

  /**
 * Clears all content under the SubMissions section while keeping the section header.
 */
  static clearSubMissions() {
    const data = fs.readFileSync(this.filePath, 'utf-8');
    const updated = data.replace(
      new RegExp(`${this.sections.subMissions}[\\s\\S]*?(##|$)`),
      `${this.sections.subMissions}\n\n$1`
    );
    fs.writeFileSync(this.filePath, updated, 'utf-8');
  }

  /**
 * Updates the checkbox status of a mission in the Mission section.
 * @param text - The mission entry text to update.
 * @param newStatus - The new status ('pending' or 'done').
 */
  static updateMissionStatus(text: string, newStatus: MissionStatus) {
    this.updateEntryStatus('mission', text, newStatus);
  }

  /**
 * Updates the checkbox status of a sub-mission in the SubMissions section.
 * @param text - The sub-mission entry text to update.
 * @param newStatus - The new status ('pending' or 'done').
 */
  static updateSubMissionStatus(text: string, newStatus: MissionStatus) {
    this.updateEntryStatus('subMissions', text, newStatus);
  }

  /**
 * Appends multiple checklist entries to a specific markdown section.
 * @param sectionKey - Section name key ('mission', 'subMissions', or 'extraInfo').
 * @param entries - An array of entries to append.
 */
  private static appendToSection(
    sectionKey: keyof typeof LogManager.sections,
    entries: Entry[]
  ) {
    const data = fs.readFileSync(this.filePath, 'utf-8');
    const section = this.sections[sectionKey];
    const entryLines = entries.map((e) => `- [${e.status === 'done' ? 'x' : ' '}] ${e.text}`).join('\n');

    const updated = data.replace(
      new RegExp(`(${section})([\\s\\S]*?)(?=\\n##|$)`),
      `$1$2\n${entryLines}`
    );

    fs.writeFileSync(this.filePath, updated.trimEnd() + '\n', 'utf-8');
  }

  /**
 * Updates the checkbox state of a specific entry in the given section.
 * @param sectionKey - The target section key.
 * @param entryText - The exact entry text to update.
 * @param newStatus - The new status to set ('pending' or 'done').
 */
  private static updateEntryStatus(
    sectionKey: keyof typeof LogManager.sections,
    entryText: string,
    newStatus: MissionStatus
  ) {
    const data = fs.readFileSync(this.filePath, 'utf-8');
    const statusMark = newStatus === 'done' ? 'x' : ' ';
    const section = this.sections[sectionKey];

    const updated = data.replace(
      new RegExp(`(${section}[\\s\\S]*?)(- \\[[ x]\\] ${this.escapeRegExp(entryText)})(.*)`),
      (_match, before, entry, after) => `${before}- [${statusMark}] ${entryText}${after}`
    );

    fs.writeFileSync(this.filePath, updated, 'utf-8');
  }

  /**
 * Escapes special RegExp characters from a string.
 * @param text - The string to escape.
 * @returns A safely escaped string usable in RegExp.
 */
  private static escapeRegExp(text: string) {
    return text.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
  }
}