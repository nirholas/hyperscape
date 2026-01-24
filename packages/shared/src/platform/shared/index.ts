/**
 * Platform-agnostic networking and storage
 */

export { Socket } from "./Socket";
export { storage, LocalStorage } from "./storage";
export {
  writePacket,
  readPacket,
  getPacketId,
  getPacketName,
  PACKET_NAMES,
} from "./packets";
export type { Storage } from "./storage";
