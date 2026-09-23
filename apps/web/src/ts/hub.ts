import { HubConnection } from "./connection";

/** Single hub link for the whole app (kept out of Pinia so the class type stays intact). */
export const hub = new HubConnection();
