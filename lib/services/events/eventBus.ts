import { EventBus, LocalEventBus } from "./event";

export const eventBus: EventBus = new LocalEventBus();
