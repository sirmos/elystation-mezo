"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  useAccount,
  useConnect,
  usePublicClient,
  useReadContract,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { BaseError, formatUnits, parseEventLogs, parseUnits } from "viem";
import { elysiumTestnet } from "@/lib/chain";
import { ADDRESSES, USDC_DECIMALS, elyPayAbi, usdcAbi } from "@/lib/contracts";
import { useFeeText } from "@/lib/useFee";

const ZERO = "0x0000000000000000000000000000000000000000" as const;

// MUSD on Mezo is borrowed against test BTC, so there is no faucet button.
const GET_MUSD = "https://mezo.org/feature/borrow";
const BTC_FAUCET = "https://faucet.test.mezo.org/";

type Action = "approve" | "pay";

function money(value: bigint) {
  const n = Number(formatUnits(value, USDC_DECIMALS));
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  });
}

function short(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function niceError(err: unknown) {
  if (err instanceof BaseError) return err.shortMessage;
  return "Something went wrong. Try again.";
}

export default function PayView({ id }: { id: string }) {
  const linkId = BigInt(id);

  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors, isPending: connecting } = useConnect();
  const { switchChain, isPending: switching } = useSwitchChain();
  const publicClient = usePublicClient({ chainId: elysiumTestnet.id });
  const feeText = useFeeText();

  const [custom, setCustom] = useState("");
  const [lastAction, setLastAction] = useState<Action | null>(null);
  const [localError, setLocalError] = useState("");

  const linkQuery = useReadContract({
    address: ADDRESSES.elyPay,
    abi: elyPayAbi,
    functionName: "links",
    args: [linkId],
    chainId: elysiumTestnet.id,
  });

  const balanceQuery = useReadContract({
    address: ADDRESSES.usdc,
    abi: usdcAbi,
    functionName: "balanceOf",
    args: [address ?? ZERO],
    chainId: elysiumTestnet.id,
    query: { enabled: !!address },
  });

  const allowanceQuery = useReadContract({
    address: ADDRESSES.usdc,
    abi: usdcAbi,
    functionName: "allowance",
    args: [address ?? ZERO, ADDRESSES.elyPay],
    chainId: elysiumTestnet.id,
    query: { enabled: !!address },
  });

  const {
    writeContract,
    data: hash,
    isPending: signing,
    error: writeError,
  } = useWriteContract();

  const {
    data: receipt,
    isLoading: confirming,
    error: receiptError,
  } = useWaitForTransactionReceipt({ hash });

  const txHash = receipt?.transactionHash;

  useEffect(() => {
    if (!receipt) return;
    if (lastAction === "approve") allowanceQuery.refetch();
    if (lastAction === "pay") {
      linkQuery.refetch();
      balanceQuery.refetch();
    }
    // Only run when a new transaction is confirmed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [txHash]);

  if (linkQuery.isLoading) {
    return (
      <div className="invoice">
        <p className="inv-title">Loading payment request</p>
      </div>
    );
  }

  const link = linkQuery.data;

  if (linkQuery.error || !link) {
    return (
      <div className="invoice">
        <p className="inv-title">We could not load this link</p>
        <p className="hint">Check your connection and refresh the page.</p>
      </div>
    );
  }

  if (link[0] === ZERO) {
    return (
      <div className="invoice">
        <p className="inv-title">This payment link does not exist</p>
        <p className="hint">Check the link with the person who sent it.</p>
        <div className="actions">
          <Link className="btn btn-secondary" href="/">
            Go to home
          </Link>
        </div>
      </div>
    );
  }

  const owner = link[0];
  const linkAmount = link[1];
  const active = link[2];
  const memo = link[5];
  const fixed = linkAmount > BigInt(0);

  let total = BigInt(0);
  let amountError = "";
  if (fixed) {
    total = linkAmount;
  } else if (custom.trim() !== "") {
    try {
      total = parseUnits(custom.trim(), USDC_DECIMALS);
      if (total <= BigInt(0)) amountError = "Enter an amount above 0.";
    } catch {
      amountError = "Enter a valid amount.";
    }
  }

  const balance = balanceQuery.data ?? BigInt(0);
  const allowance = allowanceQuery.data ?? BigInt(0);
  const wrongChain = isConnected && chainId !== elysiumTestnet.id;
  const hasFunds = balance >= total;
  const needsApproval = allowance < total;
  const busy = signing || confirming;
  const busyLabel = signing ? "Confirm in your wallet" : "Waiting for confirmation";

  let paid: {
    payer: string;
    receiver: string;
    amount: bigint;
    fee: bigint;
    hash: string;
  } | null = null;

  if (lastAction === "pay" && receipt) {
    const logs = parseEventLogs({
      abi: elyPayAbi,
      eventName: "Paid",
      logs: receipt.logs,
    });
    const first = logs[0];
    if (first) {
      paid = {
        payer: first.args.payer,
        receiver: first.args.receiver,
        amount: first.args.amount,
        fee: first.args.fee,
        hash: receipt.transactionHash,
      };
    }
  }

  const reverted = receipt?.status === "reverted";
  const errorText =
    amountError ||
    localError ||
    (writeError ? niceError(writeError) : "") ||
    (receiptError ? niceError(receiptError) : "") ||
    (reverted ? "The transaction failed on the network. Try again." : "");

  function send(next: Action) {
    setLocalError("");
    setLastAction(next);
    try {
      if (next === "approve") {
        writeContract({
          address: ADDRESSES.usdc,
          abi: usdcAbi,
          functionName: "approve",
          args: [ADDRESSES.elyPay, total],
          chainId: elysiumTestnet.id,
        });
      }
      if (next === "pay") {
        writeContract({
          address: ADDRESSES.elyPay,
          abi: elyPayAbi,
          functionName: "pay",
          args: [linkId, total],
          chainId: elysiumTestnet.id,
        });
      }
    } catch (err) {
      setLocalError(niceError(err));
    }
  }

  let main: React.ReactNode;

  if (!isConnected) {
    main = (
      <button
        className="btn btn-primary btn-block"
        disabled={connecting}
        onClick={() => connect({ connector: connectors[0] })}
      >
        {connecting ? "Check your wallet" : "Connect wallet to pay"}
      </button>
    );
  } else if (wrongChain) {
    main = (
      <button
        className="btn btn-primary btn-block"
        disabled={switching}
        onClick={() => switchChain({ chainId: elysiumTestnet.id })}
      >
        Switch to Mezo
      </button>
    );
  } else if (total <= BigInt(0)) {
    main = (
      <button className="btn btn-primary btn-block" disabled>
        Enter an amount
      </button>
    );
  } else if (!hasFunds) {
    main = (
      <>
        <p className="notice">
          Your balance is {money(balance)} MUSD. This payment needs{" "}
          {money(total)} MUSD.
        </p>
        <a
          className="btn btn-primary btn-block"
          href={GET_MUSD}
          target="_blank"
          rel="noreferrer"
        >
          Get MUSD on Mezo
        </a>
        <p className="hint">
          On the Mezo testnet, you get MUSD by borrowing against test BTC. You
          also need a little test BTC for network fees.{" "}
          <a
            href={BTC_FAUCET}
            target="_blank"
            rel="noreferrer"
            style={{ textDecoration: "underline" }}
          >
            Get free test BTC
          </a>
        </p>
        <button
          className="link-button"
          onClick={() => balanceQuery.refetch()}
        >
          I have MUSD now. Refresh my balance
        </button>
      </>
    );
  } else if (needsApproval) {
    main = (
      <>
        <button
          className="btn btn-primary btn-block"
          disabled={busy}
          onClick={() => send("approve")}
        >
          {busy ? busyLabel : `Approve ${money(total)} MUSD`}
        </button>
        <p className="hint">
          First, approve MUSD for this payment. Then you can send it.
        </p>
      </>
    );
  } else {
    main = (
      <>
        <button
          className="btn btn-primary btn-block"
          disabled={busy}
          onClick={() => send("pay")}
        >
          {busy ? busyLabel : `Pay ${money(total)} MUSD`}
        </button>
        <p className="hint">The money goes straight to the receiver.</p>
      </>
    );
  }

  return (
    <div className="invoice">
      <div className="inv-head">
        <span className="inv-title">
          {paid ? "Payment receipt" : "Payment request"}
        </span>
        <span className={paid ? "status status-live status-paid" : "status"}>
          {paid ? "Paid" : active ? "Awaiting payment" : "Link off"}
        </span>
      </div>

      <p className="inv-label">{paid ? "Amount paid" : "Amount due"}</p>

      {fixed || paid ? (
        <p className="amount">
          {money(paid ? paid.amount : linkAmount)}
          <span className="unit">MUSD</span>
        </p>
      ) : (
        <div className="amount-wrap amount-wrap-lg">
          <input
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.00"
            aria-label="Amount in MUSD"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
          />
          <span>MUSD</span>
        </div>
      )}

      <dl className="inv-rows">
        <div className="row">
          <dt>Description</dt>
          <dd>{memo || "None"}</dd>
        </div>
        <div className="row">
          <dt>Pay to</dt>
          <dd>{short(owner)}</dd>
        </div>
        {paid && (
          <div className="row">
            <dt>Paid by</dt>
            <dd>{short(paid.payer)}</dd>
          </div>
        )}
        <div className="row">
          <dt>Network</dt>
          <dd>Mezo Testnet</dd>
        </div>
        <div className="row">
          <dt>Fee</dt>
          <dd>{paid ? `${money(paid.fee)} MUSD` : feeText}</dd>
        </div>
        {paid && (
          <div className="row">
            <dt>Transaction</dt>
            <dd>
              <a
                href={`${elysiumTestnet.blockExplorers.default.url}/tx/${paid.hash}`}
                target="_blank"
                rel="noreferrer"
              >
                View on explorer
              </a>
            </dd>
          </div>
        )}
      </dl>

      {paid ? (
        <p className="hint" style={{ marginTop: 16 }}>
          This payment is final. Keep this page as your receipt.
        </p>
      ) : !active ? (
        <p className="notice" style={{ marginTop: 16 }}>
          The owner turned this link off. Ask them for a new one.
        </p>
      ) : (
        <div className="pay-actions">
          {errorText && (
            <p className="notice" role="alert">
              {errorText}
            </p>
          )}
          {main}
        </div>
      )}
    </div>
  );
}