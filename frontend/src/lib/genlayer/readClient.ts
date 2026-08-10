import { createClient } from "genlayer-js";
import { activeChain } from "./wallet";

// A wallet-less client for read-only calls (dashboard listings, public agreement
// pages) so browsing CourtFlow doesn't require connecting a wallet first.
export const readClient = createClient({ chain: activeChain });
