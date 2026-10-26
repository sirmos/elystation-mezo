"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  useAccount,
  useConnect,
  usePublicClient,
  useReadContract,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { BaseError, parseEventLogs } from "viem";
import type { Address } from "viem";
import { elysiumTestnet } from "@/lib/chain";
import { ADDRESSES, elyMarketAbi, usdcAbi } from "@/lib/contracts";
import {
  DEADLINE_OPTIONS,
  REVIEW_CHOICES,
  formatDuration,
  money,
} from "@/lib/market";
import { bpsText, useFeeFor } from "@/lib/useDiscount";
import DurationPicker from "./DurationPicker";
import LocalPrice from "./LocalPrice";

const ZERO = "0x0000000000000000000000000000000000000000" as const;

// MUSD on Mezo is borrowed against test BTC, so there is no faucet button.
const GET_MUSD = "https://mezo.org/feature/borrow";
const BTC_FAUCET = "https://faucet.test.mezo.org/";

type Action = "approve" | "create";

type Props = {
  provider: Address;
  title: string;
  price: bigint;
  onClose: () => void;
};

function niceError(err: unknown) {
  if (err instanceof BaseError) return err.shortMessage;
  return "Something went wrong. Try again.";
}

export default function HirePanel({ provider, title, price, onClose }: Props) {
  const router = useRouter();
  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors, isPending: connecting } = useConnect();
  const { switchChain, isPending: switching } = useSwitchChain();
  const publicClient = usePublicClient({ chainId: elysiumTestnet.id });
  const fee = useFeeFor(provider);

  const [deadlineSeconds, setDeadlineSeconds] = useState(604800);
  const [review, setReview] = useState<number | null>(null);
  const [lastAction, setLastAction] = useState<Action | null>(null);
  const [localError, setLocalError] = useState("");

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
    args: [address ?? ZERO, ADDRESSES.elyMarket],
    chainId: elysiumTestnet.id,
    query: { enabled: !!address },
  });

  const minQuery = useReadContract({
    address: ADDRESSES.elyMarket,
    abi: elyMarketAbi,
    functionName: "minReview",
    chainId: elysiumTestnet.id,
  });

  const maxQuery = useReadContract({
    address: ADDRESSES.elyMarket,
    abi: elyMarketAbi,
    functionName: "maxReview",
    chainId: elysiumTestnet.id,
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
    if (lastAction === "create") {
      const logs = parseEventLogs({
        abi: elyMarketAbi,
        eventName: "DealCreated",
        logs: receipt.logs,
      });
      const id = logs[0]?.args.id;
      if (id !== undefined) router.push(`/deal/${id.toString()}`);
    }
    // Run once for each confirmed transaction.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [txHash]);

  const minSec = minQuery.data !== undefined ? Number(minQuery.data) : 60;
  const maxSec = maxQuery.data !== undefined ? Number(maxQuery.data) : 14 * 86400;
  const choices = REVIEW_CHOICES.filter(
    (c) => c.seconds >= minSec && c.seconds <= maxSec
  );
  const options =
    choices.length > 0
      ? choices
      : [{ label: formatDuration(minSec), seconds: minSec }];
  const chosen =
    review ?? (options.find((o) => o.seconds === 259200)?.seconds ?? options[0].seconds);

  const balance = balanceQuery.data ?? BigInt(0);
  const allowance = allowanceQuery.data ?? BigInt(0);
  const wrongChain = isConnected && chainId !== elysiumTestnet.id;
  const busy = signing || confirming;
  const busyLabel = signing ? "Confirm in your wallet" : "Waiting for confirmation";

  const errorText =
    localError ||
    (writeError ? niceError(writeError) : "") ||
    (receiptError ? niceError(receiptError) : "") ||
    (receipt?.status === "reverted" ? "The transaction failed. Try again." : "");

  async function send(next: Action) {
    setLocalError("");
    if (!publicClient) {
      setLocalError("The network is not ready. Try again in a moment.");
      return;
    }
    setLastAction(next);
    try {
      if (next === "approve") {
        writeContract({
          address: ADDRESSES.usdc,
          abi: usdcAbi,
          functionName: "approve",
          args: [ADDRESSES.elyMarket, price],
          chainId: elysiumTestnet.id,
        });
      }
      if (next === "create") {
        const block = await publicClient.getBlock();
        const deadline = block.timestamp + BigInt(deadlineSeconds);
        writeContract({
          address: ADDRESSES.elyMarket,
          abi: elyMarketAbi,
          functionName: "createDeal",
          args: [provider, price, title, deadline, BigInt(chosen)],
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
        {connecting ? "Check your wallet" : "Connect wallet to hire"}
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
  } else if (balance < price) {
    main = (
      <>
        <p className="notice">
          Your balance is {money(balance)} MUSD. This job needs {money(price)}{" "}
          MUSD.
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
  } else if (allowance < price) {
    main = (
      <>
        <button
          className="btn btn-primary btn-block"
          disabled={busy}
          onClick={() => send("approve")}
        >
          {busy ? busyLabel : `Approve ${money(price)} MUSD`}
        </button>
        <p className="hint">
          First, approve MUSD for this job. Then you can pay into the contract.
        </p>
      </>
    );
  } else {
    main = (
      <>
        <button
          className="btn btn-primary btn-block"
          disabled={busy}
          onClick={() => send("create")}
        >
          {busy ? busyLabel : `Pay ${money(price)} MUSD and hold it`}
        </button>
        <p className="hint">
          The money waits in the contract. It is not sent to the provider yet.
        </p>
      </>
    );
  }

  return (
    <div className="hire">
      <div className="hire-head">
        <h3>
          Hire for {money(price)} MUSD
          <LocalPrice value={price} />
        </h3>
        <button className="link-button" onClick={onClose}>
          Close
        </button>
      </div>
      <p className="hint">{title}</p>

      <DurationPicker
        id="deadline"
        label="Deadline for the provider to deliver"
        hint="If the job is not delivered by then, you can take your money back."
        options={DEADLINE_OPTIONS}
        value={deadlineSeconds}
        onChange={setDeadlineSeconds}
        min={300}
        max={90 * 86400}
      />

      <DurationPicker
        id="review"
        label="Your review time after delivery"
        hint="After the provider marks the job delivered, you have this long to check the work. You can release the payment or open a dispute. If you do nothing, the provider is paid when the time ends."
        options={options}
        value={chosen}
        onChange={setReview}
        min={minSec}
        max={maxSec}
      />

      <dl className="inv-rows">
        <div className="row">
          <dt>Held by the contract</dt>
          <dd>{money(price)} MUSD</dd>
        </div>
        <div className="row">
          <dt>Fee when paid out</dt>
          <dd>{bpsText(fee.effectiveBps)}</dd>
        </div>
        <div className="row">
          <dt>Deadline to deliver</dt>
          <dd>{formatDuration(deadlineSeconds)}</dd>
        </div>
        <div className="row">
          <dt>Review time</dt>
          <dd>{formatDuration(chosen)}</dd>
        </div>
      </dl>

      {fee.qualifies && (
        <p className="hint">
          Lower fee: this provider holds MEZO, so the fee is {bpsText(fee.discountBps)}{" "}
          instead of {bpsText(fee.baseBps)}.
        </p>
      )}

      <div className="pay-actions">
        {errorText && (
          <p className="notice" role="alert">
            {errorText}
          </p>
        )}
        {main}
      </div>
    </div>
  );
}