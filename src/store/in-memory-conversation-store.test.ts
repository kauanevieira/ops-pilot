import { runConversationStoreContract } from "./conversation-store.contract.ts";
import { InMemoryConversationStore } from "./in-memory-conversation-store.ts";

runConversationStoreContract("InMemoryConversationStore", () => new InMemoryConversationStore());
