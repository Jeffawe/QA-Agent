import { Action, PageDetails, State } from "../../types.js";
import { EventEmitter } from 'events';
import { Page } from "playwright";

export type Event =
    | { ts: number; type: 'state_transition'; from: State; to: State }
    | { ts: number; type: 'action_started'; action: Action }
    | { ts: number; type: 'action_finished'; action: Action; elapsedMs: number }
    | { ts: number; type: 'llm_call'; model_name: string; promptTokens: number; respTokens: number }
    | { ts: number; type: 'screenshot_taken'; filename: string; elapsedMs: number }
    | { ts: number; type: 'error'; message: string; error?: Error }
    | { ts: number; type: 'validator_warning'; message: string }
    | { ts: number; type: 'crawl_map_updated'; page: PageDetails }
    | { ts: number; type: 'new_log'; message: string }
    | { ts: number; type: 'new_page_visited'; oldPage: string; newPage: string; page: Page }
    | { ts: number; type: 'stop'; message: string; sessionId: string }
    | { ts: number; type: 'done'; message: string };

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
    private emitter = new EventEmitter();

    emit(evt: Event) {
        this.emitter.emit(evt.type, evt);
    }

    on<T extends Event['type']>(
        type: T,
        handler: (evt: Extract<Event, { type: T }>) => void
    ) {
        this.emitter.on(type, handler as (...args: any[]) => void);
    }

    off<T extends Event['type']>(
        type: T,
        handler: (evt: Extract<Event, { type: T }>) => void
    ) {
        this.emitter.off(type, handler as (...args: any[]) => void);
    }

    removeAllListeners() {
        this.emitter.removeAllListeners();
    }
}