import { Address } from 'viem';

export type NodeType = 'batch-poster' | 'staker' | 'rpc';

/*
  Temporary type definitions
  (These are likely to be exposed or added on the Arbitrum Chain SDK in the future)
*/
type TokenBridgeParentChainContracts = {
  router: Address;
  standardGateway: Address;
  customGateway: Address;
  wethGateway: Address;
  weth: Address;
  multicall: Address;
};

type TokenBridgeOrbitChainContracts = {
  router: Address;
  standardGateway: Address;
  customGateway: Address;
  wethGateway: Address;
  weth: Address;
  proxyAdmin: Address;
  beaconProxyFactory: Address;
  upgradeExecutor: Address;
  multicall: Address;
};

export type TokenBridgeContracts = {
  parentChainContracts: TokenBridgeParentChainContracts;
  orbitChainContracts: TokenBridgeOrbitChainContracts;
};

export type DasNodeConfig = {
  'data-availability': {
    'parent-chain-node-url': string;
    'sequencer-inbox-address': string;
    'key': {
      'key-dir': string;
    };
    'local-cache': {
      enable: boolean;
    };
    'local-file-storage'?: {
      'enable'?: boolean;
      'data-dir'?: string;
    };
  };
  'enable-rpc'?: boolean;
  'rpc-addr'?: string;
  'enable-rest'?: boolean;
  'rest-addr'?: string;
  'log-level'?: string;
};
