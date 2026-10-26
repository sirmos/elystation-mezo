import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { elysiumTestnet } from "./chain";

export const wagmiConfig = createConfig({
  chains: [elysiumTestnet],
  connectors: [injected()],
  multiInjectedProviderDiscovery: false,
  transports: {
    [elysiumTestnet.id]: http("https://rpc.test.mezo.org"),
  },
  ssr: true,
});
