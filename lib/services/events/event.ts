import { Action, Namespaces, PageDetails, State, Statistics } from "../../types.js";
import { EventEmitter } from 'events';
import { Page } from "playwright";

export type Event =
    | { ts: number; type: 'state_transition'; from: State; to: State }
    | { ts: number; type: 'action_started'; action: Action; agentName: Namespaces }
    | { ts: number; type: 'action_finished'; action: Action; agentName: Namespaces; elapsedMs: number }
    | { ts: number; type: 'llm_call'; model_name: string; promptTokens: number; respTokens: number }
    | { ts: number; type: 'screenshot_taken'; filename: string; elapsedMs: number }
    | { ts: number; type: 'error'; message: string; error?: Error }
    | { ts: number; type: 'validator_warning'; message: string; agentName: Namespaces | "all" }
    | { ts: number; type: 'crawl_map_updated'; page: PageDetails }
    | { ts: number; type: 'new_log'; message: string }
    | { ts: number; type: 'new_page_visited'; oldPage: string; newPage: string; page: Page; linkIdentifier?: string; handled?: boolean; }
    | { ts: number; type: 'stop'; message: string; sessionId: string }
    | { ts: number; type: 'pause_all' }
    | { ts: number; type: 'resume_all' }
    | { ts: number; type: 'pause_agent'; agentName: Namespaces }
    | { ts: number; type: 'resume_agent'; agentName: Namespaces }
    | { ts: number; type: 'done'; message: string; sessionId: string; statistics: Statistics }
    | { ts: number; type: 'thinker_call'; message: string; model: string; level: "error" | "info" | "debug" | "warn" | "LLM_error" }
    | { ts: number; type: 'issue'; message: string; };

/** Interface the Agent depends on */
export interface EventBus {
    emit(evt: Event): void;
    on<T extends Event['type']>(
        type: T,
        handler: (evt: Extract<Event, { type: T }>) => void
    ): void;
    off<T extends Event['type']>(
        type: T,
        handler: (evt: Extract<Event, { type: T }>) => void
    ): void;
    // Method to clean up all listeners (useful for session cleanup)
    removeAllListeners(): void;
}

/** Local in-process bus based on Node's EventEmitter */
export class LocalEventBus implements EventBus {
  private emitter: EventEmitter;
  private isDestroyed = false;
  private readonly sessionId: string;
  private readonly maxListeners = 50; // Prevent memory leaks

  constructor(sessionId?: string) {
    this.sessionId = sessionId || `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    this.emitter = new EventEmitter();
    
    // Set max listeners to prevent memory leaks
    this.emitter.setMaxListeners(this.maxListeners);
    
    // Add error handling to prevent uncaught exceptions
    this.emitter.on('error', (error) => {
      console.error(`[EventBus:${this.sessionId}] EventEmitter error:`, error);
    });

    // Monitor for potential memory leaks
    this.emitter.on('newListener', (event, listener) => {
      const count = this.emitter.listenerCount(event);
      if (count > this.maxListeners * 0.8) {
        console.warn(`[EventBus:${this.sessionId}] High listener count for '${event}': ${count}`);
      }
    });
  }

  emit(evt: Event) {
    if (this.isDestroyed) {
      console.warn(`[EventBus:${this.sessionId}] Attempted to emit on destroyed bus:`, evt.type);
      return;
    }

    try {
      // Sanitize the event to prevent circular references that can cause segfaults
      const sanitizedEvent = this.sanitizeEvent(evt);
      this.emitter.emit(evt.type, sanitizedEvent);
    } catch (error) {
      console.error(`[EventBus:${this.sessionId}] Error emitting event:`, error);
      // Don't re-throw to prevent crashes
    }
  }

  on<T extends Event['type']>(
    type: T,
    handler: (evt: Extract<Event, { type: T }>) => void
  ) {
    if (this.isDestroyed) {
      console.warn(`[EventBus:${this.sessionId}] Attempted to add listener to destroyed bus:`, type);
      return;
    }

    // Wrap handler to catch errors and prevent crashes
    const safeHandler = (evt: Extract<Event, { type: T }>) => {
      try {
        handler(evt);
      } catch (error) {
        console.error(`[EventBus:${this.sessionId}] Error in event handler for '${type}':`, error);
        // Emit error event instead of crashing
        this.emit({
          ts: Date.now(),
          type: 'error',
          message: `Handler error for ${type}: ${error instanceof Error ? error.message : String(error)}`,
          error: error instanceof Error ? error : new Error(String(error))
        });
      }
    };

    this.emitter.on(type, safeHandler as (...args: any[]) => void);
  }

  off<T extends Event['type']>(
    type: T,
    handler: (evt: Extract<Event, { type: T }>) => void
  ) {
    if (this.isDestroyed) {
      return;
    }
    this.emitter.off(type, handler as (...args: any[]) => void);
  }

  removeAllListeners() {
    if (this.isDestroyed) {
      return;
    }

    console.log(`[EventBus:${this.sessionId}] Removing all listeners...`);
    
    try {
      this.emitter.removeAllListeners();
      this.isDestroyed = true;
      
      // Force garbage collection hint
      if (global.gc) {
        global.gc();
      }
    } catch (error) {
      console.error(`[EventBus:${this.sessionId}] Error removing listeners:`, error);
    }
  }

  getListenerCount(type?: string): number {
    if (this.isDestroyed) return 0;
    
    if (type) {
      return this.emitter.listenerCount(type);
    } else {
      // Return total listener count across all events
      const events = this.emitter.eventNames();
      return events.reduce((total, event) => total + this.emitter.listenerCount(event), 0);
    }
  }

  isActive(): boolean {
    return !this.isDestroyed;
  }

  // Sanitize events to prevent circular references and memory issues
  private sanitizeEvent(evt: Event): Event {
    try {
      // For events containing Playwright Page objects, remove circular references
      if (evt.type === 'new_page_visited' && 'page' in evt) {
        return {
          ...evt,
          page: null as any // Remove the page object to prevent circular refs
        };
      }
      
      // For error events, sanitize the error object
      if (evt.type === 'error' && evt.error) {
        return {
          ...evt,
          error: {
            message: evt.error.message,
            stack: evt.error.stack,
            name: evt.error.name
          } as Error
        };
      }

      return evt;
    } catch (error) {
      console.error(`[EventBus:${this.sessionId}] Error sanitizing event:`, error);
      // Return a minimal safe version
      return {
        ts: evt.ts,
        type: evt.type,
        message: 'Event sanitization failed'
      } as Event;
    }
  }
}
