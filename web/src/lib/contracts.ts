import { parseAbi } from "viem";
import type { Address } from "viem";

export const ADDRESSES = {
  // MUSD on Mezo testnet (official)
  usdc: "0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503" as Address,
  // Elystation contracts on Mezo testnet
  elyPay: "0x1e77f007C75e126659B73593cd0B92885e28e111" as Address,
  elyMarket: "0x1A7B5f4364afB7288AA12792f7406029C1062cbf" as Address,
  // MEZO token on Mezo testnet (used for the fee discount)
  elyst: "0x7B7c000000000000000000000000000000000001" as Address,
};

// Names kept so other files keep working. The asset is now MUSD (18 decimals).
export const USDC_DECIMALS = 18;
export const ELYST_DECIMALS = 18;

// Block of your first Mezo deployment. Leave 0 until you know it.
export const DEPLOY_BLOCK = BigInt(0);

export const elyPayAbi = parseAbi([
  "function createLink(uint256 amount, string memo) returns (uint256 id)",
  "function pay(uint256 id, uint256 amount)",
  "function setActive(uint256 id, bool active)",
  "function feeBps() view returns (uint16)",
  "function links(uint256) view returns (address owner, uint256 amount, bool active, uint32 payments, uint256 totalReceived, string memo)",
  "event LinkCreated(uint256 indexed id, address indexed owner, uint256 amount, string memo)",
  "event Paid(uint256 indexed id, address indexed payer, address indexed receiver, uint256 amount, uint256 fee)",
]);

export const elyMarketAbi = parseAbi([
  "function setProfile((string name, string headline, string category, string city, string bio, string contact) p)",
  "function claimHandle(string handle)",
  "function handleOf(address) view returns (string)",
  "function handleOwner(bytes32) view returns (address)",
  "function addService(string title, uint256 price)",
  "function setServiceActive(uint256 index, bool active)",
  "function getServices(address provider) view returns ((string title, uint256 price, bool active)[])",
  "function profiles(address) view returns (string name, string headline, string category, string city, string bio, string contact, uint64 updatedAt)",
  "function jobsCompleted(address) view returns (uint32)",
  "function totalEarned(address) view returns (uint256)",
  "function disputesOpened(address) view returns (uint32)",
  "function disputesLost(address) view returns (uint32)",
  "function createDeal(address provider, uint256 amount, string title, uint64 deadline, uint64 reviewSeconds) returns (uint256 id)",
  "function markDelivered(uint256 id)",
  "function release(uint256 id)",
  "function claimAfterReview(uint256 id)",
  "function refund(uint256 id)",
  "function openDispute(uint256 id, string reason)",
  "function addEvidence(uint256 id, string note)",
  "function resolve(uint256 id, uint16 providerShareBps, string ruling)",
  "function resolveAfterTimeout(uint256 id)",
  "function deals(uint256) view returns (address customer, address provider, uint256 amount, uint64 deadline, uint64 reviewSeconds, uint64 reviewEnds, uint64 resolveBy, uint8 status, string title)",
  "function feeBps() view returns (uint16)",
  "function referee() view returns (address)",
  "function minReview() view returns (uint64)",
  "function maxReview() view returns (uint64)",
  "function resolveWindow() view returns (uint64)",
  "function discountToken() view returns (address)",
  "function discountMinBalance() view returns (uint256)",
  "function discountFeeBps() view returns (uint16)",
  "event ProfileSet(address indexed provider, string name, string headline, string category, string city)",
  "event DealCreated(uint256 indexed id, address indexed customer, address indexed provider, uint256 amount, uint64 deadline, string title)",
  "event DisputeOpened(uint256 indexed id, address indexed customer, string reason)",
  "event EvidenceAdded(uint256 indexed id, address indexed by, string note)",
  "event DisputeResolved(uint256 indexed id, uint16 providerShareBps, uint256 providerNet, uint256 customerAmount, string ruling)",
]);

export const usdcAbi = parseAbi([
  "function faucet()",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
]);

export const elystAbi = parseAbi([
  "function faucet()",
  "function balanceOf(address account) view returns (uint256)",
]);
