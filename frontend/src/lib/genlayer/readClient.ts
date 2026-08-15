import { createClient } from "genlayer-js";
import { activeChain } from "./network";

// A wallet-less client for read-only calls (dashboard listings, public agreement
// pages) so browsing CourtFlow doesn't require connecting a wallet first.
// Reads go straight to the chain's own RPC, so they work regardless of which
// network the user's wallet happens to be on.
export const readClient = createClient({ chain: activeChain });
