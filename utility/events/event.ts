import { Action, State } from "../types";
import { EventEmitter } from 'events';

// events.ts
export type Event =
    | { ts: number; type: 'state_transition'; from: State; to: State }
    | { ts: number; type: 'action_started'; action: Action }
    | { ts: number; type: 'action_finished'; action: Action; elapsedMs: number }
    | { ts: number; type: 'llm_call'; promptTokens: number; respTokens: number }
    | { ts: number; type: 'screenshot_taken'; filename: string; elapsedMs: number }
    | { ts: number; type: 'error'; message: string; stack?: string };

/** Interface the Agent depends on */
export interface EventBus {
    emit(evt: Event): void;
    on<T extends Event['type']>(
        type: T,
        handler: (evt: Extract<Event, { type: T }>) => void
    ): void;
}

/** Local in-process bus based on Node's EventEmitter */
export class LocalEventBus implements EventBus {
    private emitter = new EventEmitter();

    emit(evt: Event) {
        this.emitter.emit(evt.type, evt);      // route by discriminant key
    }

    on<T extends Event['type']>(
        type: T,
        handler: (evt: Extract<Event, { type: T }>) => void
    ) {
        // Node’s EventEmitter isn’t generic-aware, so cast at the edge.
        this.emitter.on(type, handler as (...args: any[]) => void);
    }
}
