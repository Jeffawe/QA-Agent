import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { NamespacedState, State, Statistics } from '../types.js';
import { eventBusManager } from '../services/events/eventBus.js';
import { pageMemory } from '../services/memory/pageMemory.js';

type MissionStatus = 'pending' | 'done';

interface Entry {
  text: string;
  status: MissionStatus;
}

export class LogManager {
  static PROJECT_ROOT = process.cwd() || path.dirname(fileURLToPath(import.meta.url)) || '.';

  private logs: string[] = [];
  private numberOfTokens: number = 0;
  private logFilePath;
  private filePath;
  private sessionId: string = "";

  constructor(sessionId: string) {
    if (!LogManager.PROJECT_ROOT) {
      throw new Error('PROJECT_ROOT is undefined');
    }

    if (!sessionId) {
      throw new Error('sessionId is required');
    }
    this.sessionId = sessionId;
    this.logFilePath = path.join(LogManager.PROJECT_ROOT, "logs", `agent_${sessionId}.log`);
    this.filePath = path.join(LogManager.PROJECT_ROOT, "logs", `mission_log_${sessionId}.md`);
    this.log("🛠 LogManager initialized", State.INFO);
  }

  private resolveState(
    state?: NamespacedState | State,
    fallback: State = State.ERROR
  ): string {
    if (state && typeof state === "string") {
      return state; // could be NamespacedState or a State string
    }
    return fallback;
  }

  /**
   * Logs a message with a timestamp and agent state.
   * Stores it in memory, optionally prints to console, and appends it to a file.
   * @param message - The message to log.
   * @param state - The current state of the agent (default is ERROR).
   * @param logToConsole - Whether to print to console (default: true).
   */
  log(
    message: string,
    state?: NamespacedState | State,
    logToConsole: boolean = true
  ): void {
    const resolvedState = this.resolveState(state, State.INFO);
    const timestamped = `[${new Date().toISOString()}] [state: ${resolvedState}] ${message}`;
    this.logs.push(timestamped);

    if (logToConsole) console.log(timestamped);
    const eventBus = eventBusManager.getBusIfExists();
    eventBus?.emit({ ts: Date.now(), type: "new_log", message: String(message) });

    if (this.logFilePath === undefined || this.logFilePath === null) return;
    try {
      fs.mkdirSync(path.dirname(this.logFilePath), { recursive: true });
      fs.appendFileSync(this.logFilePath, timestamped + "\n");
    } catch (err) {
      console.error("Error writing to log file:", err);
    }
  }

  test_log(
    message: string,
    state?: NamespacedState | State,
    logToConsole: boolean = true
  ): void {
    const test = process.env.TEST_LOG === "true" ? true : false;
    if (!test) return;
    const resolvedState = this.resolveState(state, State.INFO);
    const timestamped = `[${new Date().toISOString()}] [state: ${resolvedState}] ${message}`;
    this.logs.push(timestamped);

    if (logToConsole) console.log(timestamped);
    const eventBus = eventBusManager.getBusIfExists();
    eventBus?.emit({ ts: Date.now(), type: "new_log", message: String(message) });

    if (this.logFilePath === undefined || this.logFilePath === null) return;
    try {
      fs.mkdirSync(path.dirname(this.logFilePath), { recursive: true });
      fs.appendFileSync(this.logFilePath, timestamped + "\n");
    } catch (err) {
      console.error("Error writing to log file:", err);
    }
  }

  /**
   * Logs an error message with a standardized format.
   * Adds it to memory and prints to console.
   * @param message - The error message to log.
   * @param state - The state where the error occurred (default is ERROR).
   * @param logToConsole - Whether to print to console (default: true).
  */
  error(
    message: string,
    state?: NamespacedState | State,
    logToConsole: boolean = true
  ): void {
    const resolvedState = this.resolveState(state, State.ERROR);
    const errorMessage = `[${new Date().toISOString()}] [state: ${resolvedState}] ${message}`;
    this.logs.push(errorMessage);
    const eventBus = eventBusManager.getBusIfExists();
    eventBus?.emit({ ts: Date.now(), type: "new_log", message: String(message) });
    eventBus?.emit({ ts: Date.now(), type: "error", message: String(message) });

    if (logToConsole) {
      console.error(errorMessage);
    }

    if (this.logFilePath === undefined || this.logFilePath === null) return;

    try {
      fs.mkdirSync(path.dirname(this.logFilePath), { recursive: true });
      fs.appendFileSync(this.logFilePath, errorMessage + "\n");
    } catch (err) {
      console.error("Error writing to log file:", err);
    }
  }

  updateTokens(tokens: number): void {
    this.numberOfTokens += tokens;
  }

  getTokens(): number {
    return this.numberOfTokens;
  }

  /**
   * Get statistics about the pages visited, links clicked, bugs found, endpoints tested, and tokens used.
   * @returns An object containing the statistics.
   */
  getStatistics(): Statistics {
    const pages = pageMemory.getAllPages()

    const totalPagesVisited = pages.length;
    let totalLinksClicked = 0;
    let totalBugsFound = 0;
    let totalEndpointsTested = 0;

    for (const page of pages) {
      const bugsOnPage = page.analysis?.bugs?.length || 0;
      const endpointsTestedOnPage = page.endpointResults?.length || 0;
      const linksClickedOnPage = page.links.filter(link => link.visited).length;
      totalBugsFound += bugsOnPage;
      totalEndpointsTested += endpointsTestedOnPage;
      totalLinksClicked += linksClickedOnPage;
    }

    const statistics: Statistics = {
      totalPagesVisited: totalPagesVisited,
      totalLinksClicked: totalLinksClicked,
      totalBugsFound: totalBugsFound,
      totalEndpointsTested: totalEndpointsTested,
      totalTokenUsage: this.numberOfTokens,
    };

    return statistics;
  }

  /**
   * Returns all logs currently stored in memory.
   * @returns An array of log strings.
  */
  getLogs(): string[] {
    return this.logs;
  }

  clearLogs(): void {
    this.logs = [];

    try {
      fs.unlinkSync(this.logFilePath);
      console.log('Log file cleared.');
    } catch (err) {
      console.error('Error clearing log file:', err);
    }
  }

  private sections = {
    mission: '## Mission',
    subMissions: '## SubMissions',
    navigationTree: '## Navigation Tree',
    extraInfo: '## Extra Info',
  };

  // Initialize the markdown file with empty sections
  initialize() {
    const content = `${this.sections.mission}\n\n${this.sections.subMissions}\n\n${this.sections.extraInfo}\n`;

    // Create directory if it doesn't exist
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Create file only if it doesn't exist
    if (!fs.existsSync(this.filePath)) {
      fs.writeFileSync(this.filePath, content, 'utf-8');
    }
  }

  /**
   * Adds a new mission entry under the Mission section in markdown.
   * @param text - The mission description.
   * @param status - The mission status ('pending' or 'done').
  */
  addMission(text: string, status: MissionStatus = 'pending') {
    const data = fs.readFileSync(this.filePath, 'utf-8');
    const section = this.sections.mission;
    const newEntry = `- [${status === 'done' ? 'x' : ' '}] ${text}`;

    const updated = data.replace(
      new RegExp(`(${section})([\\s\\S]*?)(?=\\n##|$)`),
      `$1\n\n${newEntry}\n`
    );

    fs.writeFileSync(this.filePath, updated.trimEnd() + '\n', 'utf-8');
  }

  addSubMission(text: string, status: MissionStatus = 'pending') {
    const data = fs.readFileSync(this.filePath, 'utf-8');
    const section = this.sections.subMissions;
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
  addExtraInfo(info: string) {
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
  clearSubMissions() {
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
  updateMissionStatus(text: string, newStatus: MissionStatus) {
    this.updateEntryStatus('mission', text, newStatus);
  }

  /**
 * Updates the checkbox status of a sub-mission in the SubMissions section.
 * @param text - The sub-mission entry text to update.
 * @param newStatus - The new status ('pending' or 'done').
 */
  updateSubMissionStatus(text: string, newStatus: MissionStatus) {
    this.updateEntryStatus('subMissions', text, newStatus);
  }

  /**
 * Appends multiple checklist entries to a specific markdown section.
 * @param sectionKey - Section name key ('mission', 'subMissions', or 'extraInfo').
 * @param entries - An array of entries to append.
 */
  private appendToSection(
    sectionKey: keyof typeof this.sections,
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
  private updateEntryStatus(
    sectionKey: keyof typeof this.sections,
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
  private escapeRegExp(text: string) {
    return text.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
  }

  /**
 * Deletes the log file for this session.
 * This should be called when the session is complete and logs are no longer needed.
 * @param deleteMarkdown - Whether to also delete the markdown mission log file (default: false)
 */
  deleteLogFile(deleteMarkdown: boolean = false): void {
    try {
      // Delete the main log file
      if (fs.existsSync(this.logFilePath)) {
        fs.unlinkSync(this.logFilePath);
        this.log(`🗑️ Log file deleted: ${this.logFilePath}`, State.INFO);
      } else {
        this.log(`⚠️ Log file not found for deletion: ${this.logFilePath}`, State.ERROR);
      }

      // Optionally delete the markdown mission log file
      if (deleteMarkdown && fs.existsSync(this.filePath)) {
        fs.unlinkSync(this.filePath);
        this.log(`🗑️ Mission log file deleted: ${this.filePath}`, State.INFO);
      }

      // Clear in-memory logs as well
      this.clearLogs();

    } catch (err) {
      const errorMessage = `Error deleting log file(s): ${err}`;
      console.error(errorMessage);
      // Note: We can't use this.log() here since we might have deleted the file
      // and this.log() tries to write to it
    }
  }

  /**
   * Deletes all log files in the logs directory for cleanup.
   * Use with caution - this will delete ALL session logs.
   */
  static deleteAllLogFiles(): void {
    try {
      const logsDir = path.join(LogManager.PROJECT_ROOT, "logs");

      if (fs.existsSync(logsDir)) {
        const files = fs.readdirSync(logsDir);
        let deletedCount = 0;

        for (const file of files) {
          if (file.startsWith('agent_') && file.endsWith('.log') ||
            file.startsWith('mission_log_') && file.endsWith('.md')) {
            const filePath = path.join(logsDir, file);
            fs.unlinkSync(filePath);
            deletedCount++;
          }
        }

        console.log(`🗑️ Deleted ${deletedCount} log files from ${logsDir}`);

        // Remove the logs directory if it's empty
        const remainingFiles = fs.readdirSync(logsDir);
        if (remainingFiles.length === 0) {
          fs.rmdirSync(logsDir);
          console.log(`🗑️ Removed empty logs directory: ${logsDir}`);
        }
      } else {
        console.log(`⚠️ Logs directory not found: ${logsDir}`);
      }
    } catch (err) {
      console.error(`Error deleting log files: ${err}`);
    }
  }
}