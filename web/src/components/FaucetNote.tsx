const BTC_FAUCET = "https://faucet.test.mezo.org/";
const GET_MUSD = "https://mezo.org/feature/borrow";

export default function FaucetNote() {
  return (
    <div className="callout">
      <span>
        This is a testnet on Mezo. You need a little free test BTC for network
        fees, and MUSD, which you borrow against test BTC.
      </span>
      <a
        className="btn btn-primary btn-sm"
        href={BTC_FAUCET}
        target="_blank"
        rel="noreferrer"
      >
        Get test BTC
      </a>{" "}
      <a
        className="btn btn-secondary btn-sm"
        href={GET_MUSD}
        target="_blank"
        rel="noreferrer"
      >
        Get MUSD
      </a>
    </div>
  );
}