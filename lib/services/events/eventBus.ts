import { EventBus, LocalEventBus } from "./event.js";

export const eventBus: EventBus = new LocalEventBus();
