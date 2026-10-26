"use client";

import { useAccount, useReadContract } from "wagmi";
import { formatUnits } from "viem";
import { elysiumTestnet } from "@/lib/chain";
import {
  ADDRESSES,
  ELYST_DECIMALS,
  USDC_DECIMALS,
  elystAbi,
} from "@/lib/contracts";
import { bpsText, useFeeFor } from "@/lib/useDiscount";
import { useStats } from "@/lib/useStats";

const ZERO = "0x0000000000000000000000000000000000000000" as const;
const BTC_FAUCET = "https://faucet.test.mezo.org/";
const GET_MUSD = "https://mezo.org/feature/borrow";
const MEZO_DOCS = "https://mezo.org/docs/";

function usd(value: bigint) {
  return Number(formatUnits(value, USDC_DECIMALS)).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function tokens(value: bigint) {
  return Number(formatUnits(value, ELYST_DECIMALS)).toLocaleString("en-US", {
    maximumFractionDigits: 2,
  });
}

function FeeBenefit() {
  const { address, isConnected, chainId } = useAccount();
  const fee = useFeeFor(address);

  const deployed = ADDRESSES.elyst !== ZERO;
  const wrongChain = isConnected && chainId !== elysiumTestnet.id;

  const balanceQuery = useReadContract({
    address: ADDRESSES.elyst,
    abi: elystAbi,
    functionName: "balanceOf",
    args: [address ?? ZERO],
    chainId: elysiumTestnet.id,
    query: { enabled: !!address && deployed },
  });

  return (
    <div className="panel">
      <h2>MEZO fee discount, live on testnet</h2>
      <p className="panel-note">
        Providers who hold enough MEZO pay a lower fee on services. It applies
        to services, not to payment links. The check is made by the contract
        when the provider is paid. Testnet MEZO has no value.
      </p>

      {!deployed || !fee.active ? (
        <p className="panel-note">The fee discount is not turned on yet.</p>
      ) : (
        <>
          <dl className="inv-rows">
            <div className="row">
              <dt>Standard fee</dt>
              <dd>{bpsText(fee.baseBps)}</dd>
            </div>
            <div className="row">
              <dt>Fee for MEZO holders</dt>
              <dd>{bpsText(fee.discountBps)}</dd>
            </div>
            <div className="row">
              <dt>Holding needed</dt>
              <dd>{tokens(fee.minBalance)} MEZO</dd>
            </div>
            {isConnected && (
              <>
                <div className="row">
                  <dt>Your MEZO</dt>
                  <dd>{tokens(balanceQuery.data ?? BigInt(0))}</dd>
                </div>
                <div className="row">
                  <dt>Your fee as a provider</dt>
                  <dd>{bpsText(fee.effectiveBps)}</dd>
                </div>
              </>
            )}
          </dl>

          <div className="actions">
            {!isConnected ? (
              <p className="hint">Connect your wallet to see your fee.</p>
            ) : wrongChain ? (
              <p className="hint">Switch your wallet to Mezo Testnet.</p>
            ) : (
              <a
                className="btn btn-primary"
                href={BTC_FAUCET}
                target="_blank"
                rel="noreferrer"
              >
                Get test MEZO
              </a>
            )}
          </div>
          <p className="hint">
            Get test MEZO from the Mezo faucet, then check a service profile in
            the Hire panel. The deal page shows the standard fee. Holders pay
            the lower fee when paid out.
          </p>
        </>
      )}
    </div>
  );
}

export default function TokenView() {
  const stats = useStats();

  return (
    <>
      <div className="panel">
        <h2>How Elystation uses Mezo</h2>
        <p className="panel-note">
          Elystation is a payments and hiring app for Mezo. MUSD is the only
          money that moves, and MEZO gives providers a lower fee.
        </p>
        <dl className="inv-rows">
          <div className="row">
            <dt>MUSD</dt>
            <dd>
              Every payment link, job payment and fee is in MUSD, the
              Bitcoin-backed stablecoin on Mezo.
            </dd>
          </div>
          <div className="row">
            <dt>MEZO</dt>
            <dd>
              Providers who hold a set amount of MEZO pay 0.2% instead of 0.5%
              on services. The rule is in the contract.
            </dd>
          </div>
          <div className="row">
            <dt>Getting MUSD</dt>
            <dd>
              Borrow it against Bitcoin on Mezo. The pay page links straight to
              Mezo Borrow when a payer has no MUSD.
            </dd>
          </div>
          <div className="row">
            <dt>Network</dt>
            <dd>Mezo Testnet (chain ID 31611)</dd>
          </div>
        </dl>
        <div className="asc-actions">
          <a
            className="btn btn-secondary btn-sm"
            href={GET_MUSD}
            target="_blank"
            rel="noreferrer"
          >
            Get MUSD
          </a>
          <a
            className="btn btn-secondary btn-sm"
            href={MEZO_DOCS}
            target="_blank"
            rel="noreferrer"
          >
            Mezo docs
          </a>
        </div>
      </div>

      <FeeBenefit />

      <div className="panel">
        <h2>Live usage on testnet</h2>
        <p className="panel-note">
          Read from the chain. Testnet MUSD has no value.
        </p>
        {stats ? (
          <div className="stats">
            <div className="stat">
              <strong>{stats.wallets}</strong>
              <span>unique wallets</span>
            </div>
            <div className="stat">
              <strong>{usd(stats.volume)}</strong>
              <span>test MUSD moved or held</span>
            </div>
            <div className="stat">
              <strong>{stats.payments}</strong>
              <span>link payments</span>
            </div>
            <div className="stat">
              <strong>{stats.deals}</strong>
              <span>service deals</span>
            </div>
            <div className="stat">
              <strong>{stats.links}</strong>
              <span>payment links created</span>
            </div>
            <div className="stat">
              <strong>{stats.profiles}</strong>
              <span>service profiles</span>
            </div>
          </div>
        ) : (
          <p className="panel-note">Loading</p>
        )}
      </div>

      <div className="panel">
        <h2>Not built yet</h2>
        <p className="panel-note">
          The contracts have automated tests but have not been audited. They
          are on Mezo testnet only. Mainnet needs an independent audit first.
          Signed wallet linking for the bots and a referee panel are in
          development. We will not claim any of this until it works.
        </p>
      </div>
    </>
  );
}